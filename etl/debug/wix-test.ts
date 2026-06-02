import "dotenv/config";

async function main() {
  const KEY = process.env.WIX_API_KEY!;
  const ACC = process.env.WIX_ACCOUNT_ID!;
  console.log("Key len:", KEY.length);
  console.log("Key first 30:", KEY.slice(0, 30));
  console.log("Key last 30:", KEY.slice(-30));
  console.log("Account ID:", ACC);
  console.log("Has whitespace?", /\s/.test(KEY));

  const res = await fetch("https://www.wixapis.com/site-list/v2/sites/query", {
    method: "POST",
    headers: {
      "Authorization": KEY,
      "wix-account-id": ACC,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { paging: { limit: 1 } } }),
  });
  console.log("Status:", res.status);
  console.log("Body:", (await res.text()).slice(0, 400));
}
main().catch(console.error);
