
#!/usr/bin/env python3

import argparse
import csv
import io
import json
import shutil
import sys
import zipfile
from pathlib import Path

LEVELS = set(range(0, 101, 10))


def read_csv(data):
    return list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))


def write_csv(path, rows, original_fields):
    fields = list(original_fields)

    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)

    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def fields_from_file(path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return next(csv.reader(f))


def validate_manifests(old, new):
    if old.get("status") != "complete":
        raise ValueError("Original evaluation did not complete.")

    if new.get("status") != "complete":
        raise ValueError("Density rerun did not complete.")

    if len(old["scenes"]) != 1 or len(new["scenes"]) != 1:
        raise ValueError("Expected one scene per evaluation.")

    a = old["scenes"][0]
    b = new["scenes"][0]

    if a["loadedCount"] != b["loadedCount"]:
        raise ValueError("Gaussian counts do not match.")

    if a["ids"] != b["ids"]:
        raise ValueError("Sampled Gaussian IDs do not match.")

    if len(a["views"]) != 1 or len(b["views"]) != 1:
        raise ValueError("Expected one viewpoint per evaluation.")

    va = a["views"][0]
    vb = b["views"][0]

    if va["id"] != vb["id"]:
        raise ValueError("Viewpoint IDs do not match.")

    for field in ("position", "up", "quaternion", "projectionMatrix"):
        x = va.get(field)
        y = vb.get(field)

        if x is None or y is None or len(x) != len(y):
            raise ValueError(f"Missing camera field: {field}")

        difference = max(
            abs(float(i) - float(j))
            for i, j in zip(x, y)
        )

        if difference > 1e-5:
            raise ValueError(
                f"Camera mismatch in {field}: {difference}"
            )

    return va["id"]


def merge(original_folder, density_zip, output_folder):
    required = ["manifest.json", "trials.csv", "summary.csv"]

    for name in required:
        if not (original_folder / name).is_file():
            raise ValueError(f"Missing original file: {name}")

    with zipfile.ZipFile(density_zip, "r") as z:
        for name in required:
            if name not in z.namelist():
                raise ValueError(f"Missing rerun file: {name}")

        old_manifest = json.loads(
            (original_folder / "manifest.json").read_text()
        )
        new_manifest = json.loads(z.read("manifest.json"))

        view = validate_manifests(old_manifest, new_manifest)

        old_trials = read_csv(
            (original_folder / "trials.csv").read_bytes()
        )
        new_trials = read_csv(z.read("trials.csv"))

        old_summary = read_csv(
            (original_folder / "summary.csv").read_bytes()
        )
        new_summary = read_csv(z.read("summary.csv"))

        old_density = [
            r for r in old_trials
            if r.get("control") == "density"
            and r.get("kind") == "sweep"
        ]

        new_density = [
            r for r in new_trials
            if r.get("control") == "density"
            and r.get("kind") == "sweep"
        ]

        if len(old_density) != 11 or len(new_density) != 11:
            raise ValueError(
                f"Expected 11 density trials in each run; "
                f"found {len(old_density)} old, "
                f"{len(new_density)} new."
            )

        levels = [int(float(r["level"])) for r in new_density]

        if len(set(levels)) != 11 or set(levels) != LEVELS:
            raise ValueError("Density levels are incomplete or duplicated.")

        if len(new_trials) != 11:
            raise ValueError("Rerun contains unexpected trials.")

        if any(r.get("view") != view for r in new_density):
            raise ValueError("Density trial viewpoint mismatch.")

        new_density_summary = [
            r for r in new_summary
            if r.get("group", "").endswith("/density")
        ]

        metrics = {r["metric"] for r in new_density_summary}

        if metrics != {
            "retainedGaussianFraction",
            "occupiedCellCoverage"
        } or len(new_density_summary) != 2:
            raise ValueError(
                f"Unexpected density summary metrics: {metrics}"
            )

        # Preserve all other controls.
        merged_trials = [
            r for r in old_trials
            if not (
                r.get("control") == "density"
                and r.get("kind") == "sweep"
            )
        ] + new_density

        merged_summary = [
            r for r in old_summary
            if not r.get("group", "").endswith("/density")
        ] + new_density_summary

        # Copy the original evaluation directory.
        shutil.copytree(original_folder, output_folder)

        write_csv(
            output_folder / "trials.csv",
            merged_trials,
            fields_from_file(original_folder / "trials.csv")
        )

        write_csv(
            output_folder / "summary.csv",
            merged_summary,
            fields_from_file(original_folder / "summary.csv")
        )

        # Replace only density screenshots and GPU measurements.
        replaced_files = 0

        for name in z.namelist():
            p = Path(name)

            if (
                p.parts
                and p.parts[0] in ("images", "gpu")
                and p.name.startswith("s0-v0-density-")
                and p.suffix.lower() in (".png", ".csv")
            ):
                target = output_folder / p

                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(z.read(name))
                replaced_files += 1

        if replaced_files != 22:
            shutil.rmtree(output_folder)
            raise ValueError(
                f"Expected 22 density image/GPU files; "
                f"found {replaced_files}. Output removed."
            )

        # Keep both manifests to document the experiment.
        (output_folder / "density-rerun-manifest.json").write_bytes(
            z.read("manifest.json")
        )

        old_manifest["mergedDensityRerun"] = {
            "source": density_zip.name,
            "densityTrialsReplaced": 11,
            "densityMetrics": sorted(metrics),
            "note": (
                "Original evaluation preserved except "
                "for density measurements."
            )
        }

        (output_folder / "manifest.json").write_text(
            json.dumps(old_manifest, indent=2),
            encoding="utf-8"
        )

    print(f"Successfully merged {view}")
    print(f"Total trials: {len(merged_trials)}")
    print("Density trials replaced: 11")
    print(f"Density screenshots/GPU files replaced: {replaced_files}")
    print(f"Output folder: {output_folder}")


def main():
    parser = argparse.ArgumentParser(
        description="Merge density rerun ZIP into original folder."
    )

    parser.add_argument("original_folder", type=Path)
    parser.add_argument("density_zip", type=Path)
    parser.add_argument("output_folder", type=Path)

    args = parser.parse_args()

    if not args.original_folder.is_dir():
        parser.error("Original folder does not exist.")

    if not args.density_zip.is_file():
        parser.error("Density ZIP does not exist.")

    if args.output_folder.exists():
        parser.error("Output folder already exists.")

    try:
        merge(
            args.original_folder,
            args.density_zip,
            args.output_folder
        )
    except Exception as error:
        sys.exit(f"ERROR: {error}")


if __name__ == "__main__":
    main()
