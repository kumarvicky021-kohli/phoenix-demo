chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || !tab.url.includes("gmgn.ai")) return;
  chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" }).catch(() => {});
});
