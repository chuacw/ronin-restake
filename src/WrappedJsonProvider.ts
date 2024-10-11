import { JsonRpcProvider } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import { resolveProperties } from "ethers/lib/utils";

// A wrapper to workaround the gasPrice issue in etherjs version 5 after
// London hardfork when sending transaction
//
// This is a modified version based on @ethersproject/abstract-provider
export class WrappedJsonProvider extends JsonRpcProvider {
  async getFeeData() {
    const { block, gasPrice } = await resolveProperties({
      block: this.getBlock("latest"),
      gasPrice: this.getGasPrice().catch(() => {
        return null;
      })
    });

    let lastBaseFeePerGas = null, maxFeePerGas = null, maxPriorityFeePerGas = null;

    if (block && block.baseFeePerGas) {
      lastBaseFeePerGas = block.baseFeePerGas;
      maxPriorityFeePerGas = (gasPrice != null) ? gasPrice : BigNumber.from("1500000000");
      maxFeePerGas = block.baseFeePerGas.mul(2).add(maxPriorityFeePerGas);
    }

    return { lastBaseFeePerGas, maxFeePerGas, maxPriorityFeePerGas, gasPrice };
  }
}
