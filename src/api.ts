import { mnemonicToEntropy } from "@meshsdk/core";
import { 
  Bip32PrivateKey,
  PrivateKey,
  BaseAddress,
  NetworkInfo,
  Credential,
  Ed25519KeyHash
} from '@emurgo/cardano-serialization-lib-nodejs';
import * as cbor from 'cbor';
import * as readline from 'readline';

const HARDENED = 0x80000000;
const destination = "";

async function checkWallet(mnemonic: string) {
  console.log('\n' + '='.repeat(80));
  console.log('🔍 BẮT ĐẦU KIỂM TRA VÍ');
  console.log('='.repeat(80));

  try {
    const entropyHex = mnemonicToEntropy(mnemonic);
    const entropy = Buffer.from(entropyHex, "hex");
    const pwd = new Uint8Array();

    const accountIndex = 0;
    const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, pwd);

    // Derivation path: m/1852'/1815'/0'
    const accountKey = rootKey
      .derive(1852 | HARDENED)  // purpose
      .derive(1815 | HARDENED)  // coin_type (Cardano)
      .derive(accountIndex | HARDENED);  // account

    // Payment key: m/1852'/1815'/0'/0/0
    const paymentExtKey = accountKey.derive(0).derive(0);
    // Stake key: m/1852'/1815'/0'/2/0
    const stakeExtKey = accountKey.derive(2).derive(0);

    const paymentKeyBytes = paymentExtKey.to_raw_key().as_bytes().slice(0, 32);
    const stakeKeyBytes = stakeExtKey.to_raw_key().as_bytes().slice(0, 32);

    const paymentPrivKey = PrivateKey.from_normal_bytes(paymentKeyBytes);
    const stakePrivKey = PrivateKey.from_normal_bytes(stakeKeyBytes);

    const paymentPubKey = paymentPrivKey.to_public();
    const stakePubKey = stakePrivKey.to_public();

    // Tạo Base Address
    const baseAddr = BaseAddress.new(
      NetworkInfo.mainnet().network_id(),
      Credential.from_keyhash(Ed25519KeyHash.from_bytes(paymentPubKey.hash().to_bytes())),
      Credential.from_keyhash(Ed25519KeyHash.from_bytes(stakePubKey.hash().to_bytes()))
    );

    const address = baseAddr.to_address().to_bech32();
    const addressBytes = baseAddr.to_address().to_bytes();

    console.log('\n📍 THÔNG TIN VÍ:');
    console.log('─'.repeat(80));
    console.log(`Address: ${address}`);
    console.log(`\nDerivation Path:`);
    console.log(`  Payment Key: m/1852'/1815'/0'/0/0`);
    console.log(`  Stake Key:   m/1852'/1815'/0'/2/0`);

    // Tạo chữ ký COSE_Sign1
    const message = `Assign accumulated Scavenger rights to: ${destination}`;
    const messageBytes = Buffer.from(message, "utf8");

    const protectedHeader = cbor.encode(new Map([[1, -8]]));
    const unprotectedHeader = new Map<number | string, Buffer | Uint8Array>([
      [4, Buffer.from(paymentPubKey.as_bytes())],
      ["address", addressBytes]
    ]);
    
    const payload = messageBytes;
    const sigStructure = cbor.encode([
      "Signature1",
      protectedHeader,
      Buffer.alloc(0),
      payload
    ]);
    
    const rawSignature = paymentPrivKey.sign(Buffer.from(sigStructure));
    const coseSign1 = cbor.encode([
      protectedHeader,
      unprotectedHeader,
      payload,
      Buffer.from(rawSignature.to_bytes())
    ]);
    
    const signatureHex = coseSign1.toString('hex');

    console.log(`\n🔐 CHỮ KÝ:`);
    console.log('─'.repeat(80));
    console.log(`Message: ${message}`);
    console.log(`\nSignature (hex):`);
    console.log(signatureHex);
    
    console.log(`\n🔗 DONATE URL:`);
    console.log('─'.repeat(80));
    const donateUrl = `https://scavenger.prod.gd.midnighttge.io/donate_to/${destination}/${address}/${signatureHex}`;
    console.log(donateUrl);

    console.log('\n' + '='.repeat(80));
    console.log('✅ HOÀN THÀNH!');
    console.log('='.repeat(80));

  } catch (error: any) {
    console.log('\n❌ LỖI:', error.message);
  }
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('🔐 KIỂM TRA VÍ CARDANO');
  console.log('Nhập 24 từ mnemonic (cách nhau bởi dấu cách):');
  
  rl.question('> ', async (input) => {
    const mnemonic = input.trim();
    
    if (!mnemonic) {
      console.log('❌ Vui lòng nhập mnemonic!');
      rl.close();
      return;
    }

    const words = mnemonic.split(/\s+/);
    if (words.length !== 24) {
      console.log(`❌ Mnemonic phải có 24 từ (bạn nhập ${words.length} từ)`);
      rl.close();
      return;
    }

    await checkWallet(mnemonic);
    rl.close();
  });
}

main();