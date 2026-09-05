const input = document.getElementById("apiKey");
const status = document.getElementById("status");
const saveBtn = document.getElementById("save");

chrome.storage.local.get(["apiKey"], (res) => {
  if (res && res.apiKey) input.value = res.apiKey;
});

saveBtn.addEventListener("click", () => {
  const key = input.value.trim();
  chrome.storage.local.set({ apiKey: key }, () => {
    status.textContent = key ? "✅ Chiave salvata." : "Chiave rimossa.";
    setTimeout(() => (status.textContent = ""), 2500);
  });
});
