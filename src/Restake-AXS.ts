import assert from "assert";
import process from "process";
import { Contract__factory as AxieInfinityContractFactory } from './contracts/factories/Contract__factory';
import { RoninJsonRpcProvider as RoninJsonRpcProviderV1 } from "web3-ronin-provider/web3-RoninJsonRpcProvider";
import { BaseContract, BigNumber, ethers } from "ethers";
import { fromBlockchainTimestamp, DiffDuration, isValidDate } from "delphirtl/dateutils";
import { CreateDir, ExtractFileDir, GetCurrentDir, hasFieldOfType, IncludeTrailingPathDelimiter, isArbitraryObject, SetCurrentDir } from "delphirtl/sysutils";
import Wallet from 'ethereumjs-wallet';
import { isAddress } from "ethers/lib/utils";
import { URL_RONIN_MAINNET_RPC } from "web3-ronin-provider/web3-ronin-consts";

import { resolveProperties } from "ethers/lib/utils";

import 'dotenv/config';
require('dotenv').config();

import Web3 from 'web3';
import winston from "winston";

const private_key: string = process.env.private_key || "";
const X_API_KEY: string = process.env.X_API_KEY || "";
const AXS_CONTRACT_ADDR: string = process.env.AXS_CONTRACT_ADDR || "";

const alignColorsAndTime = winston.format.combine(
  winston.format.colorize({
    all: true
  }),
  winston.format.label({
    label: '[LOGGER]'
  }),
  winston.format.timestamp({
    format: "YYYY-MM-DD HH:mm:ss"
  }),
  winston.format.printf(
    info => `${info.label}  ${info.timestamp}  ${info.level}: ${info.message}`
  )
);

function getLoggingPath(): string {
  const d = new Date();
  const path = IncludeTrailingPathDelimiter(ExtractFileDir(ExtractFileDir(__filename))) + "logs";
  CreateDir(path);
  const filename = IncludeTrailingPathDelimiter(path) + 'Restake-AXS-' + [
    d.getFullYear(),
    ('0' + (d.getMonth() + 1)).slice(-2),
    ('0' + d.getDate()).slice(-2),
    ('0' + d.getHours()).slice(-2),
    ('0' + d.getMinutes()).slice(-2),
    ('0' + d.getSeconds()).slice(-2)
  ].join('-') + '.log';
  return filename;
}

const filename = getLoggingPath();
const logger = winston.createLogger({
  transports: [
    new winston.transports.File({ filename }),
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), alignColorsAndTime)
    })
  ]
});

export type HistoricalFee = {
  baseFeePerGas: string[];
  gasUsedRatio: number[];
  oldestBlock: string;
  reward: string[][];
}

export type FormattedFeeHistory = {
  number: number | string;
  baseFeePerGas: number;
  gasUsedRatio: number;
  priorityFeePerGas: number[] | null
}

/**
 * A wrapper to workaround gasPrice issue in etherjs v5 after London
 * hardfork when sending transactions for Ronin.
 */
class RoninJsonRpcProvider extends RoninJsonRpcProviderV1 {
  readonly #FIFTEEN: BigNumber;
  #logEnabled!: boolean;

  /**
   * Creates an instance of RoninJsonRpcProvider.
   *
   * @constructor
   * @param {?(ethers.utils.ConnectionInfo | string)} [url] The URL to use, headers, etc
   * @param {?ethers.providers.Networkish} [network]
   * @throws {@link EEmptyHeaders} when headers are present, but empty
   * @throws {@link EEmptyUrl} when URL is empty
   * @throws {@link ENoApiKey} when X-API-KEY is absent
   * @throws {@link ENoHeaders} when headers are absent
   */
  constructor(url?: ethers.utils.ConnectionInfo | string, network?: ethers.providers.Networkish) {
    super(url, network);
    this.#FIFTEEN = BigNumber.from("1700000000");
    this.disableLog();
  }

  enableLog() {
    this.#logEnabled = true;
  }

  disableLog() {
    this.#logEnabled = false;
  }

  override async getFeeData() {
    const { block, gasPrice } = await resolveProperties({
      block: this.getBlock("latest"),
      gasPrice: this.getGasPrice().catch(() => {
        const Gwei = Web3.utils.fromWei("20", "Gwei");
        return BigNumber.from(Gwei);
      })
    });

    let lastBaseFeePerGas = null, maxFeePerGas = null, maxPriorityFeePerGas = null;

    if (block && block.baseFeePerGas) {
      lastBaseFeePerGas = block.baseFeePerGas;
      maxPriorityFeePerGas = // (gasPrice != null) ? gasPrice : this.#FIFTEEN;
        BigNumber.from(await this.getFeeEstimate());
      maxFeePerGas = block.baseFeePerGas.mul(2).add(maxPriorityFeePerGas);
    }

    const result = { lastBaseFeePerGas, maxFeePerGas, maxPriorityFeePerGas, gasPrice };
    if (this.#logEnabled) {
      logger.log('info', `fees: ${JSON.stringify(result)}`);
    }
    return result;
  }

  formatFeeHistory(result: HistoricalFee, historicalBlocks: number = 4, includePending: boolean = false) {
    let blockNum: BigNumber = BigNumber.from(result.oldestBlock);
    let index = 0;
    const blocks = [];
    while (index < historicalBlocks) {
      blocks.push({
        number: Number(blockNum.toString()),
        baseFeePerGas: Number(result.baseFeePerGas[index]),
        gasUsedRatio: Number(result.gasUsedRatio[index]),
        priorityFeePerGas: result.reward[index].map(x => Number(x)),
      });
      blockNum = blockNum.add(1);
      index += 1;
    }
    if (includePending) {
      blocks.push({
        number: "pending",
        baseFeePerGas: Number(result.baseFeePerGas[historicalBlocks]),
        gasUsedRatio: 0,
        priorityFeePerGas: [0, 0, 0, 0],
      });
    }
    return blocks;
  }

  /**
   * getFeeHistory gets the history for blocks from the pending block to the past historicalBlocks.
   * By default, this would be the past 4 blocks, if historicalBlocks is left at the default.
   * This is an implementation of EIP 1559.
   *
   * @async
   * @param {number} [historicalBlocks=4]
   * @returns {Promise<FormattedFeeHistory[]>}
   */
  async getFeeHistory(historicalBlocks: number = 4): Promise<FormattedFeeHistory[]> {
    const feeHistory = await this.send("eth_feeHistory", [historicalBlocks, "pending", [25, 50, 75]]);
    const formattedFeeHistory = this.formatFeeHistory(feeHistory);
    return formattedFeeHistory;
  }

  /**
   * getFeeEstimate estimates the fee for the next transaction
   *
   * @async
   * @returns {Promise<number>}
   */
  async getFeeEstimate(): Promise<number> {
    const feeHistory = await this.getFeeHistory();
    // @ts-ignore
    const firstPercentialPriorityFees = feeHistory.map(b => b.priorityFeePerGas[0]!);
    const sum = firstPercentialPriorityFees.reduce((a, v) => a + v);
    const result = Math.round(sum / firstPercentialPriorityFees.length);
    return result;
  }

}

/**
 * createRoninJsonRpcProvider creates a RoninJsonRpcProvider given the X_API_KEY
 *
 * @param {string} X_API_KEY
 * @param {?string} [url]
 * @returns {RoninJsonRpcProvider}
 */
function createRoninJsonRpcProvider(X_API_KEY: string, url?: string): RoninJsonRpcProvider {
  const connection = { url: url || URL_RONIN_MAINNET_RPC, headers: { "X-API-KEY": X_API_KEY } };
  const result = new RoninJsonRpcProvider(connection);
  return result;
}

let GlobalProvider: RoninJsonRpcProvider;
function getProvider(): RoninJsonRpcProvider {
  assert(private_key !== "", "Private key not set");
  assert(X_API_KEY !== "", "API KEY not set");
  let result: RoninJsonRpcProvider;
  if (!GlobalProvider) {
    GlobalProvider = createRoninJsonRpcProvider(X_API_KEY);
  }
  result = GlobalProvider;
  return result;
}

function getSigner() {
  const provider = getProvider();

  const result = new ethers.Wallet(private_key, provider);
  return result;
}

async function checkCanClaim(provider: RoninJsonRpcProvider, stakedEvents: any[], claimedEvents: any[]) {
  const stakeIndex = stakedEvents.length - 1;
  const lastStakedBlockNumber = stakeIndex >= 0 ? stakedEvents[stakeIndex].blockNumber : -1;
  const stakeBlock = stakeIndex >= 0 ? await provider.getBlock(lastStakedBlockNumber) : { timestamp: 0 };
  const lastStakeDate = fromBlockchainTimestamp(stakeBlock.timestamp);

  const claimIndex = claimedEvents.length - 1;
  const lastClaimBlockNumber = claimIndex >= 0 ? claimedEvents[claimIndex].blockNumber : -1;
  const claimBlock = claimIndex >= 0 ? await provider.getBlock(lastClaimBlockNumber) : { timestamp: 0 };
  const lastClaimDate = fromBlockchainTimestamp(claimBlock.timestamp);
  return { lastClaimDate, lastStakeDate };
}

async function RestakeRewards() {

  assert(AXS_CONTRACT_ADDR !== "", "AXS_CONTRACT_ADDR is not set!");

  const wallet = getWallet();
  const WALLET_ADDR = wallet.getAddressString();
  logger.log('info', `Checking claims for ${WALLET_ADDR}...`)

  const provider = getProvider();
  const balance = await provider.getBalance(WALLET_ADDR);

  const ZERO = BigNumber.from(0);
  if (balance.eq(ZERO)) {
    logger.log('error', "Wallet balance is 0. Can't continue.");
    return;
  }

  const signer = getSigner();
  const AxieInfinityContract = AxieInfinityContractFactory.connect(AXS_CONTRACT_ADDR, signer);
  const pendingRewards = await AxieInfinityContract.getPendingRewards(wallet.getAddressString());
  assert(GlobalProvider !== undefined);
  assert(GlobalProvider !== null);

  if (pendingRewards.eq(ZERO)) {
    logger.log("error", "Pending rewards is 0. Can't continue.");
    return;
  }

  const pendingRewardsNumber = Web3.utils.fromWei(pendingRewards.toBigInt(), "ether");
  logger.log("info", `Pending claim: ${pendingRewardsNumber} AXS`);

  logger.log("info", 'Checking claims within the past 1 day...')

  const { claimedEvents, stakedEvents } = await ReadEvents();
  const { lastClaimDate, lastStakeDate } = await checkCanClaim(provider, stakedEvents, claimedEvents);
  let canClaim = false;

  const NOW = new Date();
  if (isValidDate(lastStakeDate)) {
    const nextStakeDate = lastStakeDate.addHours(24);
    if (nextStakeDate < NOW) {
      canClaim = true;
    }
  }
  if (!canClaim && isValidDate(lastClaimDate)) {
    const nextClaimDate = lastClaimDate.addHours(24);
    if (nextClaimDate < NOW) {
      canClaim = true;
    }
  }
  if (!canClaim) {
    if (lastStakeDate.isValidDate()) {
      logger.log("error", `Can't claim, last claim event at: ${lastStakeDate.toLocaleString()}`);
      const nextClaimDate = lastStakeDate.addHours(24);
      const duration = DiffDuration(new Date(), nextClaimDate);
      logger.log("info", `Please wait until ${nextClaimDate.toLocaleString()} or another ${duration.hours} hrs ${duration.minutes}m ${duration.seconds}s`);
      return;
    }
  }

  logger.log("info", 'Sending claim...')
  let transaction: ethers.ContractTransaction | undefined = undefined;
  try {
    try {
      GlobalProvider.enableLog();
      transaction = await AxieInfinityContract.restakeRewards();
    } catch (e) {
      if (isArbitraryObject(e) && (isArbitraryObject(e.error) && hasFieldOfType<string>(e.error, "message", "string") && e.error.message === "transaction underpriced")) {
        const feeData = await provider.getFeeData();
        logger.log("info", feeData);
        const txOpts: ethers.Overrides = {
          gasLimit: BigNumber.from("170000"),
          gasPrice: Web3.utils.fromWei("20", "Gwei"),
          maxPriorityFeePerGas: feeData.maxPriorityFeePerGas!,
          maxFeePerGas: feeData.maxFeePerGas!,
          nonce: provider.getTransactionCount(WALLET_ADDR)
        };
        transaction = await AxieInfinityContract.restakeRewards(txOpts);
        logger.log("info", 'txOpts: ' + JSON.stringify(txOpts));
      }
      logger.log("error", "error e below");
      logger.log("error", JSON.stringify(e));
    }
    if (transaction)
      logger.log("info", `Claim sent. Hash: ${transaction.hash}`);
  } catch (e) {
    logger.log("error", "Failed to send restakeRewards...");
    if (e instanceof Error && hasFieldOfType<string>(e, "code", "string") && e.code === "INSUFFICIENT_FUNDS") {
      logger.log("error", "Insufficient funds!");
      logger.log("error", JSON.stringify(e));
      return;
    }
    logger.log("error", 'Unexpected error below');
    logger.log("error", JSON.stringify(e));
    return;
  }
}

async function isValidAPIKey(contract: BaseContract): Promise<boolean> {
  let result = true;
  try {
    const valid_API_key = await contract.deployed();
  } catch (e) {
    result = false;
  }
  return result;
}

function getWallet() {
  try {
    const wallet = Wallet.fromPrivateKey(
      Buffer.from(private_key.substring(2).match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || [])
    );
    return wallet;
  } catch (e) {
    const fakeWallet = {
      getAddressString() {
        return "";
      }
    }
    return fakeWallet;
  }
}

/**
 * Original internalReadEvents
 * 
 * 
 * 
 * @param days 
 * @returns 
 */
async function internalReadEvents(days: number) {
  // const savedEventsFile = 
  assert(isAddress(AXS_CONTRACT_ADDR), "AXS_CONTRACT_ADDR is invalid!"); // asserts address is valid

  const wallet = getWallet();
  const MY_ADDR = wallet.getAddressString();

  assert(MY_ADDR != "", "MY_ADDR is not provided!");
  logger.log("info", 'Reading events...')
  const signer = getSigner();
  const provider = getProvider();
  const AxieInfinityContract = AxieInfinityContractFactory.connect(AXS_CONTRACT_ADDR, signer);
  assert(await isValidAPIKey(AxieInfinityContract), "API key might be invalid!");

  const stakeEventFilter = AxieInfinityContract.filters.Staked(MY_ADDR);
  const claimEventFilter = AxieInfinityContract.filters.RewardClaimed(MY_ADDR);
  const endBlock = await provider.getBlockNumber();
  const OneDay = 28_800;
  const MAX_BLOCKS = 500;
  let startBlock = endBlock - (OneDay * days);
  let tempEndBlock = startBlock + MAX_BLOCKS; // MAX_BLOCKS
  let now = new Date();
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
  // find block number that's more than 1 day(24 hours) away
  logger.log("info", `Current block: ${endBlock}`);
  logger.log("info", `Checking from block: ${startBlock} to block: ${endBlock}`);
  logger.log("info", "Finding block numbers...");
  logger.log("info", 'Querying events...');
  let stakedEvents: any[] = [];
  let claimedEvents: any[] = [];

  do {
    logger.log("info", `Checking blocks: ${startBlock} to ${tempEndBlock}, endBlock: ${endBlock}`);
    const temp_combinedEvents = await AxieInfinityContract.queryFilter(
      { topics: [stakeEventFilter.topics as any, claimEventFilter.topics] },
      startBlock, tempEndBlock
    );
    const temp_stakedEvents = await AxieInfinityContract.queryFilter(stakeEventFilter, startBlock, tempEndBlock);
    const temp_claimedEvents = await AxieInfinityContract.queryFilter(claimEventFilter, startBlock, tempEndBlock);
    stakedEvents = [...stakedEvents, ...temp_stakedEvents];
    claimedEvents = [...claimedEvents, ...temp_claimedEvents];
    // if (temp_combinedEvents.length > 0 || temp_claimedEvents.length > 0 || temp_stakedEvents.length > 0) {
    //   debugger
    // }
    let filtered_stakedEvents = temp_combinedEvents.filter((value, index, array) => { value.topics });
    stakedEvents = [...stakedEvents];
    claimedEvents = [...claimedEvents];
    startBlock = tempEndBlock + 1;
    tempEndBlock = startBlock + MAX_BLOCKS;
  } while (startBlock <= endBlock);
  const sortedStakedEvents = stakedEvents.sort((a, b) => a.blockNumber - b.blockNumber);
  const sortedClaimedEvents = claimedEvents.sort((a, b) => a.blockNumber - b.blockNumber);
  return { sortedClaimedEvents, sortedStakedEvents };
}

/**
 * Gets Staked events in the last 24 hours
 */
async function ReadEvents() {
  const { sortedClaimedEvents, sortedStakedEvents } = await internalReadEvents(2);
  return { claimedEvents: sortedClaimedEvents, stakedEvents: sortedStakedEvents };
}

const cwd = GetCurrentDir();
try {
  const newDir = ExtractFileDir(ExtractFileDir(__filename));
  SetCurrentDir(newDir);
  RestakeRewards(); 
} finally {
  SetCurrentDir(cwd);
}