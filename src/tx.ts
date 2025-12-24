import { mnemonicToEntropy } from "@meshsdk/core";
import {
  Bip32PrivateKey,
  PrivateKey,
  BaseAddress,
  NetworkInfo,
  Credential,
  Ed25519KeyHash,
  TransactionBuilder,
  TransactionBuilderConfigBuilder,
  TransactionOutput,
  TransactionInput,
  TransactionHash,
  TransactionWitnessSet,
  Transaction,
  Value,
  LinearFee,
  BigNum,
  Address,
  Vkeywitnesses,
  make_vkey_witness,
  MultiAsset,
  Assets,
  AssetName,
  ScriptHash
} from "@emurgo/cardano-serialization-lib-nodejs";
import * as readline from "readline";
import axios from "axios";
import { blake2b } from "blakejs";

const HARDENED = 0x80000000;

// Blockfrost API
const BLOCKFROST_API_KEY = ''; // Thay bằng API key của bạn
const BLOCKFROST_URL = 'https://cardano-mainnet.blockfrost.io/api/v0';

// Địa chỉ nhận (B)
const DESTINATION =
  "";

// ⚠️ UTXOs thật của ví owner (BẮT BUỘC phải đúng)
const OWNER_UTXOS = [
  {
    txHash: "c46adbf1139410b59f5e20e11f105823d78e47960028edef86e4f5b841aa10cf",
    index: 1,
    lovelace: "4092780", // 4.09278 ADA
    assets: [
      {
        policyId: "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa",
        assetName: "4e49474854", // NIGHT
        quantity: "9537512406"
      }
    ]
  }
];

// Số lượng token muốn gửi
const TOKEN_AMOUNT = ""; // 1 billion NIGHT tokens

// Hàm gửi transaction
async function submitTransaction(txCborHex: string): Promise<string> {
  try {
    console.log("\n📡 Đang gửi transaction lên blockchain...");
    const response = await axios.post(
      `${BLOCKFROST_URL}/tx/submit`,
      Buffer.from(txCborHex, 'hex'),
      {
        headers: { 
          'project_id': BLOCKFROST_API_KEY,
          'Content-Type': 'application/cbor'
        }
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('❌ Lỗi khi gửi transaction:', error.response?.data || error.message);
    throw error;
  }
}

async function buildTx(mnemonic: string) {
  console.log("\n================ BUILD CARDANO TX ================\n");

  // 1️⃣ Derive root key
  const entropyHex = mnemonicToEntropy(mnemonic);
  const entropy = Buffer.from(entropyHex, "hex");
  const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array());

  // 2️⃣ Derive account key m/1852'/1815'/0'
  const accountKey = rootKey
    .derive(1852 | HARDENED)
    .derive(1815 | HARDENED)
    .derive(0 | HARDENED);

  // 3️⃣ Payment key m/1852'/1815'/0'/0/0
  const paymentExtKey = accountKey.derive(0).derive(0);
  const paymentPrivKey = PrivateKey.from_normal_bytes(
    paymentExtKey.to_raw_key().as_bytes().slice(0, 32)
  );
  const paymentPubKey = paymentPrivKey.to_public();

  // 4️⃣ Stake key m/1852'/1815'/0'/2/0
  const stakeExtKey = accountKey.derive(2).derive(0);
  const stakePrivKey = PrivateKey.from_normal_bytes(
    stakeExtKey.to_raw_key().as_bytes().slice(0, 32)
  );
  const stakePubKey = stakePrivKey.to_public();

  // 5️⃣ Build base address
  const baseAddr = BaseAddress.new(
    NetworkInfo.mainnet().network_id(),
    Credential.from_keyhash(
      Ed25519KeyHash.from_bytes(paymentPubKey.hash().to_bytes())
    ),
    Credential.from_keyhash(
      Ed25519KeyHash.from_bytes(stakePubKey.hash().to_bytes())
    )
  );

  const ownerAddress = baseAddr.to_address().to_bech32();

  console.log("Owner address:", ownerAddress);

  // 6️⃣ Transaction Builder config
  const txBuilder = TransactionBuilder.new(
    TransactionBuilderConfigBuilder.new()
      .fee_algo(
        LinearFee.new(
          BigNum.from_str("44"),
          BigNum.from_str("155381")
        )
      )
      .coins_per_utxo_byte(BigNum.from_str("4310"))
      .key_deposit(BigNum.from_str("2000000"))
      .pool_deposit(BigNum.from_str("500000000"))
      .max_value_size(5000)
      .max_tx_size(16384)
      .build()
  );

  // 7️⃣ Add ALL INPUTs (tất cả UTXOs để có đủ ADA)
  console.log(`\n💰 Thêm ${OWNER_UTXOS.length} UTXOs làm input...`);
  
  for (const utxo of OWNER_UTXOS) {
    const input = TransactionInput.new(
      TransactionHash.from_bytes(Buffer.from(utxo.txHash, "hex")),
      utxo.index
    );

    // Tạo Value với ADA + token (nếu có)
    const inputValue = Value.new(BigNum.from_str(utxo.lovelace));
    
    if (utxo.assets && utxo.assets.length > 0) {
      const multiAsset = MultiAsset.new();
      
      for (const asset of utxo.assets) {
        const assets = Assets.new();
        assets.insert(
          AssetName.new(Buffer.from(asset.assetName, "hex")),
          BigNum.from_str(asset.quantity)
        );
        multiAsset.insert(
          ScriptHash.from_bytes(Buffer.from(asset.policyId, "hex")),
          assets
        );
      }
      
      inputValue.set_multiasset(multiAsset);
    }

    txBuilder.add_key_input(
      paymentPubKey.hash(),
      input,
      inputValue
    );
    
    console.log(`  ✅ UTXO ${utxo.txHash.slice(0, 16)}... (${parseInt(utxo.lovelace)/1000000} ADA)`);
  }
  
  const totalAda = OWNER_UTXOS.reduce((sum, u) => sum + parseInt(u.lovelace), 0);
  console.log(`💵 Tổng input: ${totalAda / 1000000} ADA`);

  // 8️⃣ Add OUTPUT (gửi token + min ADA sang địa chỉ nhận)
  const minAda = "1200000"; // 1.2 ADA (min ADA để giữ token - giảm xuống)
  const outputValue = Value.new(BigNum.from_str(minAda));
  
  // Thêm token vào output
  const outputMultiAsset = MultiAsset.new();
  const outputAssets = Assets.new();
  outputAssets.insert(
    AssetName.new(Buffer.from("4e49474854", "hex")), // NIGHT
    BigNum.from_str(TOKEN_AMOUNT)
  );
  outputMultiAsset.insert(
    ScriptHash.from_bytes(Buffer.from("0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa", "hex")),
    outputAssets
  );
  outputValue.set_multiasset(outputMultiAsset);
  
  txBuilder.add_output(
    TransactionOutput.new(
      Address.from_bech32(DESTINATION),
      outputValue
    )
  );
  
  console.log(`🌟 Gửi ${TOKEN_AMOUNT} NIGHT tokens + ${parseInt(minAda)/1000000} ADA`);

  // 9️⃣ Add change
  txBuilder.add_change_if_needed(
    Address.from_bech32(ownerAddress)
  );

  // 🔟 Build tx body
  const txBody = txBuilder.build();

  // 1️⃣1️⃣ Hash transaction body bằng Blake2b-256
  const txBodyBytes = txBody.to_bytes();
  const txHashBytes = blake2b(txBodyBytes, undefined, 32); // 32 bytes = 256 bits
  const txHash = TransactionHash.from_bytes(Buffer.from(txHashBytes));
  
  const vkeyWitnesses = Vkeywitnesses.new();
  const vkeyWitness = make_vkey_witness(txHash, paymentPrivKey);
  vkeyWitnesses.add(vkeyWitness);
  
  const witnesses = TransactionWitnessSet.new();
  witnesses.set_vkeys(vkeyWitnesses);

  // 1️⃣2️⃣ Final transaction
  const tx = Transaction.new(txBody, witnesses);
  const txHex = Buffer.from(tx.to_bytes()).toString("hex");

  console.log("\n✅ TRANSACTION CBOR HEX:");
  console.log(txHex);

  // 1️⃣3️⃣ Submit transaction
  try {
    const txId = await submitTransaction(txHex);
    console.log("\n" + "=".repeat(80));
    console.log("✅ GIAO DỊCH THÀNH CÔNG!");
    console.log("=".repeat(80));
    console.log(`\n🆔 Transaction ID: ${txId}`);
    console.log(`🔗 Xem trên Cardano Explorer:`);
    console.log(`   https://cardanoscan.io/transaction/${txId}`);
    console.log("=".repeat(80) + "\n");
  } catch (error) {
    console.log("\n❌ KHÔNG THỂ GỬI TRANSACTION!");
    console.log("Bạn có thể submit thủ công bằng CBOR hex ở trên.\n");
  }
}

function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log("Nhập mnemonic 24 từ:");
  rl.question("> ", async (input) => {
    const mnemonic = input.trim();
    if (mnemonic.split(/\s+/).length !== 24) {
      console.log("❌ Mnemonic phải đủ 24 từ");
      rl.close();
      return;
    }

    await buildTx(mnemonic);
    rl.close();
  });
}

main();
