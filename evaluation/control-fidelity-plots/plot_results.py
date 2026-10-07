from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt

files = {
    "View 1": Path("view1/trials.csv"),
    "View 2": Path("view2/trials.csv"),
    "View 3": Path("view3/trials.csv"),
}

data = {
    name: pd.read_csv(path)
    for name, path in files.items()
}

panels = [
    ("strokeScale", "majorRatio", "Stroke scale", "Major axis / baseline"),
    ("elongation", "aspectRatioRatio", "Elongation", "Aspect ratio / baseline"),
    ("directionality", "horizontalDeviationDegrees", "Directionality", "Deviation from horizontal (degrees)"),
    ("abstraction", "retainedSampleRatio", "Abstraction: retention", "Retained sample fraction"),
    ("abstraction", "laplacianDetailProxy", "Abstraction: image detail", "Laplacian detail proxy"),
    ("density", "meanEffectiveVertexAlpha", "Density", "Mean vertex alpha"),
]

colors = ["#286496", "#c36c28", "#388454"]
styles = ["-", "--", ":"]

plt.rcParams.update({
    "font.size": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "pdf.fonttype": 42,
})

fig, axes = plt.subplots(
    2, 3, figsize=(12, 7), constrained_layout=True
)

for ax, (control, metric, title, ylabel) in zip(
    axes.flat, panels
):
    for i, (name, df) in enumerate(data.items()):
        rows = df.loc[
            (df["kind"] == "sweep")
            & (df["control"] == control)
        ].sort_values("level")

        ax.plot(
            rows["level"],
            rows[metric],
            label=name,
            color=colors[i],
            linestyle=styles[i],
            linewidth=2,
        )

    ax.set_title(title)
    ax.set_xlabel("Control value (%)")
    ax.set_ylabel(ylabel)
    ax.set_xticks(range(0, 101, 20))
    ax.grid(alpha=0.2)

axes[0, 0].legend()

fig.savefig("control-response-plots.pdf", bbox_inches="tight")
fig.savefig(
    "control-response-plots.png",
    dpi=300,
    bbox_inches="tight",
)

plt.show()