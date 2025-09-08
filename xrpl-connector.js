// xrpl-connector.js
async function getLedgerInfo() {
  try {
    const response = await fetch("/api/xrpl/ledger");
    const data = await response.json();
    console.log("Ledger Info:", data);
    return data;
  } catch (err) {
    console.error("Error fetching ledger info:", err);
  }
}

async function getAccountInfo(account) {
  try {
    const response = await fetch(`/api/xrpl/account/${account}`);
    const data = await response.json();
    console.log("Account Info:", data);
    return data;
  } catch (err) {
    console.error("Error fetching account info:", err);
  }
}

// Example usage
document.getElementById("getLedgerBtn").addEventListener("click", getLedgerInfo);
document.getElementById("getAccountBtn").addEventListener("click", () => {
  const account = document.getElementById("accountInput").value.trim();
  if (account) getAccountInfo(account);
});
