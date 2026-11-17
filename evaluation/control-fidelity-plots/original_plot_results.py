
from pathlib import Path
from matplotlib.lines import Line2D
from matplotlib.ticker import PercentFormatter

import pandas as pd
import matplotlib.pyplot as plt

# --------------------------------------------------
# Configuration
# --------------------------------------------------

scenes = {
    "Garden": {
        "folder": Path("garden"),
        "color": "#578470",
    },
    "Kitchen": {
        "folder": Path("kitchen"),
        "color": "#d35e44",
    },
    "Bicycle": {
        "folder": Path("bicycle"),
        "color": "#e7b23a",
    },
}

view_styles = {
    "view1": "-",
    "view2": "--",
    "view3": ":",
}

# Minimum fraction of on-screen Gaussians retained
# by the density implementation at slider value 0.
MIN_ONSCREEN_RETENTION = 0.10

EXPECTED_LEVELS = list(range(0, 101, 10))

# --------------------------------------------------
# Load evaluation data
# --------------------------------------------------

data = []

for scene, settings in scenes.items():
    files = sorted(settings["folder"].glob("view*.csv"))

    if not files:
        raise FileNotFoundError(
            f"No view CSV files found in {settings['folder']}"
        )

    for path in files:
        view = path.stem.lower()

        if view not in view_styles:
            raise ValueError(
                f"Unknown viewpoint: {path.name}"
            )

        data.append({
            "scene": scene,
            "view": view,
            "color": settings["color"],
            "path": path,
            "df": pd.read_csv(path),
        })

# --------------------------------------------------
# Plot configuration
# --------------------------------------------------

panels = [
    (
        "strokeScale",
        "majorRatio",
        "Stroke scale",
        "Major axis / baseline",
    ),
    (
        "elongation",
        "aspectRatioRatio",
        "Elongation",
        "Aspect ratio / baseline",
    ),
    (
        "directionality",
        "horizontalDeviationDegrees",
        "Directionality",
        "Deviation from horizontal (degrees)",
    ),
    (
        "abstraction",
        "retainedSampleRatio",
        "Abstraction: retention",
        "Retained sample fraction",
    ),
    (
        "abstraction",
        "laplacianDetailProxy",
        "Abstraction: image detail",
        "Laplacian detail proxy",
    ),
    (
        "density",
        "retainedGaussianFraction",
        "Density",
        "On-screen Gaussian retention (%)",
    ),
]

plt.rcParams.update({
    "font.family": "sans-serif",
    "font.size": 10,
    "text.color": "#000000",
    "axes.labelcolor": "#000000",
    "axes.titlecolor": "#000000",
    "axes.edgecolor": "#000000",
    "xtick.color": "#000000",
    "ytick.color": "#000000",
    "axes.spines.top": False,
    "axes.spines.right": False,
    "pdf.fonttype": 42,
})

# Use DM Sans if installed.
from matplotlib import font_manager

installed_fonts = {
    font.name for font in font_manager.fontManager.ttflist
}

if "DM Sans" in installed_fonts:
    plt.rcParams["font.family"] = "DM Sans"

# --------------------------------------------------
# Density correction
# --------------------------------------------------

def estimate_onscreen_retention(
    rows,
    metric="retainedGaussianFraction",
    minimum_retention=MIN_ONSCREEN_RETENTION,
):
    """
    Estimate retention among Gaussians affected by
    screen-space density filtering.

    Model:
        measured = offscreen + (1 - offscreen) * onscreen

    Assumptions:
        - Off-screen Gaussians remain retained.
        - The off-screen fraction is constant within
          a viewpoint's density sweep.
        - At density slider 0, the on-screen
          retention fraction is minimum_retention.
        - At density slider 100, all are retained.

    This is an inferred estimate, not a direct
    measurement of on-screen Gaussian counts.
    """

    zero_rows = rows.loc[
        rows["level"] == 0, metric
    ]

    if len(zero_rows) != 1:
        raise ValueError(
            "Expected exactly one density measurement at 0%."
        )

    measured_at_zero = float(zero_rows.iloc[0])

    if not minimum_retention <= measured_at_zero <= 1:
        raise ValueError(
            "Recorded minimum density retention is "
            "incompatible with the correction model."
        )

    offscreen_fraction = (
        measured_at_zero - minimum_retention
    ) / (1.0 - minimum_retention)

    onscreen_fraction = 1.0 - offscreen_fraction

    if onscreen_fraction <= 1e-9:
        raise ValueError(
            "Cannot estimate on-screen retention: "
            "estimated on-screen population is zero."
        )

    estimated = (
        rows[metric] - offscreen_fraction
    ) / onscreen_fraction

    # Clamp small numerical deviations.
    estimated = estimated.clip(0.0, 1.0)

    return estimated, offscreen_fraction

# --------------------------------------------------
# Create figure
# --------------------------------------------------

fig, axes = plt.subplots(
    3,
    2,
    figsize=(7, 12),
)

density_estimates = []

for ax, (control, metric, title, ylabel) in zip(
    axes.flat,
    panels,
):
    for item in data:
        df = item["df"]

        required_columns = {
            "kind",
            "control",
            "level",
            metric,
        }

        missing = required_columns - set(df.columns)

        if missing:
            raise ValueError(
                f"Missing columns {sorted(missing)} in "
                f"{item['path']}"
            )

        rows = df.loc[
            (df["kind"] == "sweep")
            & (df["control"] == control),
            ["level", metric],
        ].copy()

        if rows.empty:
            raise ValueError(
                f"No {control} measurements for "
                f"{item['scene']} {item['view']}"
            )

        rows["level"] = pd.to_numeric(
            rows["level"],
            errors="raise",
        )

        rows[metric] = pd.to_numeric(
            rows[metric],
            errors="coerce",
        )

        rows = rows.sort_values("level")

        if rows[metric].isna().any():
            raise ValueError(
                f"Invalid '{metric}' values in "
                f"{item['path']}"
            )

        plot_values = rows[metric].copy()

        # ------------------------------------------
        # Apply density correction
        # ------------------------------------------

        if control == "density":
            if rows["level"].tolist() != EXPECTED_LEVELS:
                raise ValueError(
                    f"Incomplete or duplicated density "
                    f"levels in {item['path']}"
                )

            if not rows[metric].between(0, 1).all():
                raise ValueError(
                    f"Density retention must be between "
                    f"0 and 1 in {item['path']}"
                )

            plot_values, offscreen_fraction = (
                estimate_onscreen_retention(rows, metric)
            )

            density_estimates.append({
                "scene": item["scene"],
                "view": item["view"],
                "estimatedOffscreenFraction": (
                    offscreen_fraction
                ),
                "estimatedOnscreenFraction": (
                    1.0 - offscreen_fraction
                ),
                "measuredRetentionAtZero": (
                    float(
                        rows.loc[
                            rows["level"] == 0,
                            metric,
                        ].iloc[0]
                    )
                ),
            })

        # ------------------------------------------
        # Plot curves
        # ------------------------------------------

        ax.plot(
            rows["level"],
            plot_values,
            color=item["color"],
            linestyle=view_styles[item["view"]],
            linewidth=2,
        )

    ax.set_title(title)
    ax.set_xlabel("Control value (%)")
    ax.set_ylabel(ylabel)

    ax.set_xlim(-5, 105)
    ax.set_xticks(range(0, 101, 20))

    ax.grid(alpha=0.2)

    if control == "density":
        ax.set_ylim(0, 1.02)

        ax.yaxis.set_major_formatter(
            PercentFormatter(
                xmax=1.0,
                decimals=0,
            )
        )

# --------------------------------------------------
# Legend
# --------------------------------------------------

scene_handles = [
    Line2D(
        [0],
        [0],
        color=settings["color"],
        linewidth=2,
        label=scene,
    )
    for scene, settings in scenes.items()
]

present_views = sorted({
    item["view"] for item in data
})

view_handles = [
    Line2D(
        [0],
        [0],
        color="#000000",
        linestyle=view_styles[view],
        linewidth=2,
        label=(
            f"View {view.removeprefix('view')}"
        ),
    )
    for view in present_views
]

fig.legend(
    handles=scene_handles + view_handles,
    loc="upper center",
    bbox_to_anchor=(0.5, 0.995),
    ncol=3,
    frameon=False,
)

fig.tight_layout(
    rect=(0, 0, 1, 0.94)
)

# --------------------------------------------------
# Export figure
# --------------------------------------------------

fig.savefig(
    "control-response-plots.pdf",
    bbox_inches="tight",
)

fig.savefig(
    "control-response-plots.png",
    dpi=300,
    bbox_inches="tight",
)

# --------------------------------------------------
# Export density correction information
# --------------------------------------------------

estimates_df = pd.DataFrame(density_estimates)

estimates_df.to_csv(
    "density-onscreen-estimates.csv",
    index=False,
)

print("\nEstimated density population fractions:")
print(
    estimates_df.to_string(
        index=False,
        float_format=lambda x: f"{x:.4f}",
    )
)

print("\nSaved:")
print("  control-response-plots.pdf")
print("  control-response-plots.png")
print("  density-onscreen-estimates.csv")

plt.show()