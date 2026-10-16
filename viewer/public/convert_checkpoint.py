
import argparse
from pathlib import Path

import numpy as np
from safetensors import safe_open


def convert_checkpoint(input_path, output_path):
    input_path = Path(input_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with safe_open(str(input_path), framework="np", device="cpu") as f:
        data = {
            key: f.get_tensor(key)
            for key in (
                "mean",
                "scale",
                "rotation",
                "opacity",
                "sh_coeffs_dc",
                "sh_coeffs_rest",
            )
        }

    n = data["mean"].shape[0]
    print(f"Converting {n:,} Gaussians...")

    names = (
        ["x", "y", "z"]
        + [f"f_dc_{i}" for i in range(3)]
        + [f"f_rest_{i}" for i in range(45)]
        + ["opacity"]
        + [f"scale_{i}" for i in range(3)]
        + [f"rot_{i}" for i in range(4)]
    )

    dtype = np.dtype([(name, "<f4") for name in names])

    with open(output_path, "wb") as out:
        header = [
            "ply",
            "format binary_little_endian 1.0",
            f"element vertex {n}",
        ]
        header += [f"property float {name}" for name in names]
        header.append("end_header")
        out.write(("\n".join(header) + "\n").encode("ascii"))

        for start in range(0, n, 50000):
            end = min(start + 50000, n)
            count = end - start

            chunk = np.empty(count, dtype=dtype)

            for i, name in enumerate(["x", "y", "z"]):
                chunk[name] = data["mean"][start:end, i]

            dc = data["sh_coeffs_dc"][start:end, 0, :]
            for i in range(3):
                chunk[f"f_dc_{i}"] = dc[:, i]

            rest = data["sh_coeffs_rest"][start:end]
            rest = rest.transpose(0, 2, 1).reshape(count, 45)
            for i in range(45):
                chunk[f"f_rest_{i}"] = rest[:, i]

            chunk["opacity"] = data["opacity"][start:end, 0]

            for i in range(3):
                chunk[f"scale_{i}"] = data["scale"][start:end, i]

            for i in range(4):
                chunk[f"rot_{i}"] = data["rotation"][start:end, i]

            chunk.tofile(out)
            print(f"Exported {end:,}/{n:,}")

    print(f"Saved: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    args = parser.parse_args()

    convert_checkpoint(args.input, args.output)