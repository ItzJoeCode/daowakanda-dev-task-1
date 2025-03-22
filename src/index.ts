// Wallet Address: 6YXWG22RNSHGAFKC7KJMDHQMLRVRSFECQCRBQNMEFOQ2GIC4BBZNVEHKOA

import algosdk, { makeAssetTransferTxnWithSuggestedParamsFromObject } from "algosdk";
import * as algokit from "@algorandfoundation/algokit-utils";
import { AppClient } from "@algorandfoundation/algokit-utils/types/app-client";
import { SMART_CONTRACT_ARC_32 } from "./client";

// The app ID to interact with.
const appId = 736014374;

async function loadClient() {
  const client = algokit.AlgorandClient.fromConfig({
    algodConfig: {
      server: "https://testnet-api.algonode.cloud",
    },
    indexerConfig: {
      server: "https://testnet-idx.algonode.cloud",
    },
  });

  return client;
}

async function loadAccount() {
  const client = await loadClient();
  const account = client.account.fromMnemonic(
    "mnemonic"
  );

  return account;
}

async function getGlobalState(appId: number) {
  const client = await loadClient();
  const appInfo = await client.client.algod.getApplicationByID(appId).do();
  const globalState = appInfo.params["global-state"].map((entry: any) => ({
    key: Buffer.from(entry.key, "base64").toString(),
    value: entry.value,
  }));
  console.log("Global State:", globalState);
  return globalState;
}

async function claimAsset(appId: number) {
  const client = await loadClient();
  const account = await loadAccount();

  const appClient = new AppClient({
    appId: BigInt(appId),
    appSpec: JSON.stringify(SMART_CONTRACT_ARC_32),
    algorand: client,
  });

  const suggestedParams = await client.client.algod.getTransactionParams().do();

  const globalState = await appClient.getGlobalState();
  const assetId = globalState.asset.value;
  console.log("Asset ID:", assetId);

  if (!assetId) {
    throw new Error("Asset ID not found in global state. Cannot claim asset.");
  }

  const assetBalance = await client.client.algod
    .accountAssetInformation(account.addr, Number(assetId))
    .do();
  console.log("User's asset balance before claiming:", assetBalance);

  if (assetBalance["asset-holding"] === undefined) {
    console.log("User is not opted into the asset. Opting in...");
    const assetOptinTxn = makeAssetTransferTxnWithSuggestedParamsFromObject({
      amount: 0,
      from: account.addr,
      to: account.addr,
      suggestedParams,
      assetIndex: Number(assetId),
    });

    const signedOptinTxn = await account.signer([assetOptinTxn], [0]);
    await client.client.algod.sendRawTransaction(signedOptinTxn).do();
    console.log("Opted into the asset successfully.");
  }

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    method: appClient.getABIMethod("claimAsset"),
    suggestedParams: {
      ...suggestedParams,
      fee: 6_000,
    },
    sender: account.addr,
    signer: account.signer,
    appID: appId,
    appForeignAssets: [Number(assetId)],
  });

  console.log("Executing claimAsset transaction...");
  try {
    const response = await atc.execute(client.client.algod, 8);
    console.log("Claim asset response:", response);

    const updatedAssetBalance = await client.client.algod
      .accountAssetInformation(account.addr, Number(assetId))
      .do();

    console.log("User's asset balance after claiming:", updatedAssetBalance);
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error during asset claim:", error.message);
    } else {
      console.error("Unknown error during asset claim:", error);
    }
    throw error;
  }
}

async function main() {
  try {
    console.log("Fetching global state...");
    const globalState = await getGlobalState(appId);

    const assetKey = globalState.find((entry: { key: string; value: any }) => entry.key === "asset");
    if (assetKey && assetKey.value.uint) {
      console.log("Asset already exists with ID:", assetKey.value.uint);
    } else {
      throw new Error("Asset does not exist in the global state. Cannot proceed.");
    }

    console.log("Claiming asset...");
    await claimAsset(appId);
    console.log("Asset claimed successfully.");
  } catch (error) {
    console.error("An error occurred during execution:", error);
  }
}

main();