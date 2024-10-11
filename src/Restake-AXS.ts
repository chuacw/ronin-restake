import assert from "assert";
import AxieInfinityABI from "../contract-abi/contract.json";
import 'dotenv/config';
import process from "process";
import { Contract__factory as AxieInfinityContractFactory } from './contracts/factories/Contract__factory';
import { RONIN_MAINNET_RPC } from "./ronin-nodes-const";
import { BaseContract, ethers } from "ethers";
import { WrappedJsonProvider } from "./WrappedJsonProvider";
import { fromBlockchainTimestamp, DiffDuration } from "delphirtl/dateutils";
import Wallet from 'ethereumjs-wallet';

require('dotenv').config();

const private_key = process.env.private_key || "";
const X_API_KEY = process.env.X_API_KEY || "";
const AXS_CONTRACT_ADDR = process.env.AXS_CONTRACT_ADDR || "";

function getProvider(): WrappedJsonProvider {
  assert(private_key !== "", "Private key not set");
  assert(X_API_KEY !== "", "API KEY not set");
  const connection_info = {
    headers: {
      "X-API-KEY": X_API_KEY
    },
    url: RONIN_MAINNET_RPC,
  };
  const provider = new WrappedJsonProvider(connection_info);
  return provider;
}

function getSigner() {
  const provider = getProvider();

  const signer = new ethers.Wallet(private_key, provider);
  return signer;
}

async function RestakeRewards() {
  assert(AXS_CONTRACT_ADDR !== "", "AXS_CONTRACT_ADDR is not set!");

  console.log('Checking claims...')

  const stakedEvents = await ReadEvents();
  let canClaim = stakedEvents.length == 0;
  const index = stakedEvents.length - 1;
  const lastClaimBlockNumber = stakedEvents[index].blockNumber;
  const provider = getProvider();
  const block = await provider.getBlock(lastClaimBlockNumber)
  const lastClaimDate = fromBlockchainTimestamp(block.timestamp);
  if (!canClaim) {
    const now = new Date();
    const diffMS = now.valueOf() - lastClaimDate.valueOf();
    let diffDays = Math.floor(diffMS / 86400000);
    canClaim = diffDays >= 1;
  }
  if (!canClaim) {
    console.error(`Can't claim, last claim event at: ${lastClaimDate.toLocaleString()}`);
    const nextClaimDate = lastClaimDate.addHours(24);
    const duration = DiffDuration(new Date(), nextClaimDate);
    console.log(`Please wait until ${nextClaimDate.toLocaleString()} or another ${duration.hours} hrs ${duration.minutes}m ${duration.seconds}s`);
    return;
  }
  console.log('Sending claim...')
  const signer = getSigner();
  // Type 1
  const AxieInfinityContract = new ethers.Contract(AXS_CONTRACT_ADDR, AxieInfinityABI, signer); // this works!
  const transaction = await AxieInfinityContract.functions.restakeRewards();
  console.log(`Claim sent. Hash: ${transaction.hash}`);

  // Type 2
  // const AxieInfinityContract = AxieInfinityContractFactory.connect(CONTRACT_ADDR, signer);
  // const pendingRewards = await AxieInfinityContract.getPendingRewards();
}

function isValidAddr(addr: string): boolean {
  let result = true;
  try {
    ethers.utils.getAddress(addr); // asserts address is valid
  } catch(e) {
    if (e instanceof Error) {
      if (("reason" in e) && (e.reason == "invalid address")) {
        return false;
      }
      throw e;
    }
  }
  return result;
}

async function isValidAPIKey(contract: BaseContract): Promise<boolean> {
  let result = true;
  try {
    const valid_API_key = await contract.deployed();
  } catch(e) {
    result = false;
  }
  return result;
}

async function internalReadEvents(days: number) {
  const buffer = Buffer.from(private_key.substring(2).match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
  assert(buffer.length == 32, "private key is not 32 bytes in length!");
  assert(isValidAddr(AXS_CONTRACT_ADDR), "AXS_CONTRACT_ADDR is invalid!"); // asserts address is valid

  const wallet = Wallet.fromPrivateKey(buffer);
  const MY_ADDR = wallet.getAddressString();
  assert(MY_ADDR != "", "MY_ADDR is not provided!");
  console.log('Reading events...')
  const signer = getSigner();
  const provider = getProvider();
  const AxieInfinityContract = AxieInfinityContractFactory.connect(AXS_CONTRACT_ADDR, signer);
  assert(await isValidAPIKey(AxieInfinityContract), "API key might be invalid!");

  const stakeEventFilter = AxieInfinityContract.filters.Staked(MY_ADDR);
  const blockNumber = await provider.getBlockNumber();
  const currentBlockNumber = blockNumber;
  const OneDay = 28_800;
  const MAX_BLOCKS = 500;
  let startBlock = blockNumber - (OneDay * days);
  let endBlock = startBlock + MAX_BLOCKS - 1; // MAX_BLOCKS
  let now = new Date();
  // find block number that's more than 1 day(24 hours) away
  console.log("Finding block numbers...");
  do {
    const block = await provider.getBlock(startBlock);
    let date = fromBlockchainTimestamp(block.timestamp)
    let diffMS = now.valueOf() - date.valueOf();
    let diffDays = Math.floor(diffMS / 86400000);
    if (diffDays >= days) {
      break;
    } else {
      startBlock = startBlock - MAX_BLOCKS;
    }
  } while (true);
  console.log('Querying events...');
  let stakedEvents: any[] = [];
  do {
    const temp_stakedEvents = await AxieInfinityContract.queryFilter(stakeEventFilter, startBlock, endBlock);
    stakedEvents = [...stakedEvents, ...temp_stakedEvents];
    startBlock = endBlock + 1;
    endBlock = startBlock + MAX_BLOCKS - 1;
  } while (startBlock < currentBlockNumber);
  const sortedStakedEvents = stakedEvents.sort((a, b) => a.blockNumber - b.blockNumber);
  return sortedStakedEvents;
}

/**
 * Gets Staked events in the last 24 hours
 */
async function ReadEvents() {
  const stakedEvents = await internalReadEvents(1);
  return stakedEvents;
}

RestakeRewards();