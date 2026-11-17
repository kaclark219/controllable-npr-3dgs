from pathlib import Path
from matplotlib.lines import Line2D

import pandas as pd
import matplotlib.pyplot as plt

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
            raise ValueError(f"Unknown viewpoint: {path.name}")

        data.append({
            "scene": scene,
            "view": view,
            "color": settings["color"],
            "df": pd.read_csv(path),
        })

panels = [
    # (
    #     "strokeScale", "majorRatio",
    #     "Stroke scale", "Major axis / baseline"
    # ),
    # (
    #     "elongation", "aspectRatioRatio",
    #     "Elongation", "Aspect ratio / baseline"
    # ),
    (
        "directionality", "horizontalDeviationDegrees",
        "Directionality", "Deviation from horizontal (degrees)"
    ),
    (
        "abstraction", "retainedSampleRatio",
        "Abstraction: retention", "Retained sample fraction"
    ),
    # (
    #     "abstraction", "laplacianDetailProxy",
    #     "Abstraction: image detail", "Laplacian detail proxy"
    # ),
    (
        "density", "meanEffectiveVertexAlpha",
        "Density", "Mean vertex alpha"
    ),
]

plt.rcParams.update({
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

fig, axes = plt.subplots(
    1, 3, figsize=(15, 4)
)

for ax, (control, metric, title, ylabel) in zip(
    axes.flat, panels
):
    for item in data:
        df = item["df"]

        rows = df.loc[
            (df["kind"] == "sweep")
            & (df["control"] == control),
            ["level", metric],
        ].copy()

        rows["level"] = pd.to_numeric(
            rows["level"], errors="raise"
        )
        rows[metric] = pd.to_numeric(
            rows[metric], errors="raise"
        )
        rows = rows.sort_values("level")

        if rows.empty:
            raise ValueError(
                f"No {control} measurements for "
                f"{item['scene']} {item['view']}"
            )

        ax.plot(
            rows["level"],
            rows[metric],
            color=item["color"],
            linestyle=view_styles[item["view"]],
            linewidth=2,
        )

    ax.set_title(title)
    ax.set_xlabel("Control value (%)")
    ax.set_ylabel(ylabel)
    ax.set_xticks(range(0, 101, 20))
    ax.grid(alpha=0.2)

scene_handles = [
    Line2D(
        [0], [0],
        color=settings["color"],
        linewidth=2,
        label=scene,
    )
    for scene, settings in scenes.items()
]

present_views = sorted({item["view"] for item in data})

view_handles = [
    Line2D(
        [0], [0],
        color="#666667",
        linestyle=view_styles[view],
        linewidth=2,
        label=f"View {view.removeprefix('view')}",
    )
    for view in present_views
]

fig.legend(
    handles=scene_handles + view_handles,
    loc="upper center",
    bbox_to_anchor=(0.5, 1.02),
    ncol=6,
    columnspacing=1.5,
    handletextpad=0.5,
    frameon=False,
)

fig.subplots_adjust(top=0.8)

fig.tight_layout(rect=(0, 0, 1, 0.9))

fig.savefig(
    "control-response-plots.pdf",
    bbox_inches="tight",
)
fig.savefig(
    "control-response-plots.png",
    dpi=300,
    bbox_inches="tight",
)

plt.show()