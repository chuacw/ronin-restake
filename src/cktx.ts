import { createRoninJsonRpcProvider } from "web3-ronin-provider";
import assert from "assert";

import { ParamCount, ParamStr } from "delphirtl";

import 'dotenv/config';
require('dotenv').config();

async function main() {
  if (ParamCount() == 0) {
    console.log('No parameters given!');
    return;
  }
  const X_API_KEY: string = process.env.X_API_KEY || "";
  assert(X_API_KEY !== "", "API KEY not set");
  const provider = createRoninJsonRpcProvider(X_API_KEY);
  const tx_hash = ParamStr(1);
  const tx_response = await provider.getTransaction(tx_hash);
  console.log(JSON.stringify(tx_response));
}

main();