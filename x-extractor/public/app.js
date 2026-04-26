const form = document.querySelector("#extractForm");
const input = document.querySelector("#tweetUrl");
const button = document.querySelector("#startButton");
const clearButton = document.querySelector("#clearButton");
const statusPill = document.querySelector("#statusPill");
const phase = document.querySelector("#phase");
const retweeterCount = document.querySelector("#retweeterCount");
const quoteCount = document.querySelector("#quoteCount");
const logBox = document.querySelector("#logBox");
const fileGrid = document.querySelector("#fileGrid");

let pollTimer = null;

function setStatus(status, label) {
  statusPill.className = `status-pill ${status || ""}`.trim();
  statusPill.textContent = label;
}

function renderJob(job) {
  phase.textContent = job.phase || "-";
  retweeterCount.textContent = job.counts?.retweeters ?? 0;
  quoteCount.textContent = job.counts?.quotes ?? 0;
  logBox.textContent = (job.progress || []).join("\n") || "运行中...";

  if (job.status === "running") setStatus("running", "运行中");
  if (job.status === "done") setStatus("done", "完成");
  if (job.status === "error") setStatus("error", "失败");

  if (job.error) {
    logBox.textContent = `${logBox.textContent}\n\n错误：${job.error}`;
  }

  if (job.files) {
    const labels = {
      retweetersCsv: "转发者 CSV",
      retweetersJson: "转发者 JSON",
      quotesCsv: "引用 CSV",
      quotesJson: "引用 JSON",
    };
    fileGrid.innerHTML = Object.entries(job.files)
      .map(
        ([key, href]) =>
          `<a href="${href}" download>${labels[key] || key}<br><span class="muted">${href}</span></a>`,
      )
      .join("");
  }
}

async function pollJob(id) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
  const job = await response.json();
  if (!response.ok) throw new Error(job.error || "读取任务失败");
  renderJob(job);

  if (job.status !== "running") {
    clearInterval(pollTimer);
    pollTimer = null;
    button.disabled = false;
    button.textContent = "开始提取";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = input.value.trim();
  if (!url) {
    setStatus("error", "请输入链接");
    return;
  }

  clearInterval(pollTimer);
  button.disabled = true;
  button.textContent = "提取中";
  fileGrid.innerHTML = '<span class="muted">正在生成...</span>';
  logBox.textContent = "任务已提交。";
  setStatus("running", "运行中");

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "启动任务失败");
    await pollJob(payload.id);
    pollTimer = setInterval(() => {
      pollJob(payload.id).catch((error) => {
        clearInterval(pollTimer);
        pollTimer = null;
        button.disabled = false;
        button.textContent = "开始提取";
        setStatus("error", "失败");
        logBox.textContent += `\n${error.message}`;
      });
    }, 1000);
  } catch (error) {
    button.disabled = false;
    button.textContent = "开始提取";
    setStatus("error", "失败");
    logBox.textContent = error instanceof Error ? error.message : String(error);
  }
});

clearButton.addEventListener("click", () => {
  logBox.textContent = "日志已清空。";
});
