/*
 * TrueClick — background service worker (Manifest V3)
 *
 * Pure local relay + badge driver. No network, no storage of anything except an
 * in-memory per-tab flag cache that the popup reads.
 *
 *   content.js  --TC_REPORT-->  background  --setBadgeText-->  toolbar
 *   popup.js    --TC_GET_TAB_FLAGS-->  background  --> cached flags
 */

var ALERT_COLOR = "#B8452E";

// tabId -> { count, flags }
var flagsByTab = {};

chrome.runtime.onInstalled.addListener(function () {
  chrome.action.setBadgeBackgroundColor({ color: ALERT_COLOR });
});
// Also set on worker startup (onInstalled doesn't fire on every wake).
chrome.action.setBadgeBackgroundColor({ color: ALERT_COLOR });

function setBadge(tabId, count) {
  var text = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ tabId: tabId, text: text });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  if (msg.type === "TC_REPORT") {
    var tabId = sender.tab && sender.tab.id;
    if (typeof tabId === "number") {
      flagsByTab[tabId] = { count: msg.count || 0, flags: msg.flags || [] };
      setBadge(tabId, msg.count || 0);
    }
    return false;
  }

  if (msg.type === "TC_GET_TAB_FLAGS") {
    var wantTab = msg.tabId;
    var entry = flagsByTab[wantTab] || { count: 0, flags: [] };
    sendResponse(entry);
    return false;
  }

  return false;
});

// Clear cache + badge when a tab navigates or closes.
chrome.tabs.onRemoved.addListener(function (tabId) {
  delete flagsByTab[tabId];
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading" && changeInfo.url) {
    delete flagsByTab[tabId];
    setBadge(tabId, 0);
  }
});
