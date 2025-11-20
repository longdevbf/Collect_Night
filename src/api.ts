import axios from 'axios';
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
import * as fs from 'fs';
import * as path from 'path';

const destination = "";
const BASE_URL = "https://scavenger.prod.gd.midnighttge.io";
const HARDENED = 0x80000000;

interface WalletInfo {
  name: string;
  network: string;
  mnemonic: string;
  address: string;
  payment_signing_key: string;
  payment_verification_key: string;
  stake_signing_key: string;
  stake_verification_key: string;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processWallet(walletInfo: WalletInfo) {
  const mnemonic = walletInfo.mnemonic;
  const entropyHex = mnemonicToEntropy(mnemonic);
  const entropy = Buffer.from(entropyHex, "hex");
  const pwd = new Uint8Array();

  const accountIndex = 0;
  const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, pwd);

  const accountKey = rootKey
    .derive(1852 | HARDENED)
    .derive(1815 | HARDENED)
    .derive(accountIndex | HARDENED);

  const paymentExtKey = accountKey.derive(0).derive(0);
  const stakeExtKey = accountKey.derive(2).derive(0);

  const paymentKeyBytes = paymentExtKey.to_raw_key().as_bytes().slice(0, 32);
  const stakeKeyBytes = stakeExtKey.to_raw_key().as_bytes().slice(0, 32);

  const paymentPrivKey = PrivateKey.from_normal_bytes(paymentKeyBytes);
  const stakePrivKey = PrivateKey.from_normal_bytes(stakeKeyBytes);

  const paymentPubKey = paymentPrivKey.to_public();
  const stakePubKey = stakePrivKey.to_public();

  const baseAddr = BaseAddress.new(
    NetworkInfo.mainnet().network_id(),
    Credential.from_keyhash(Ed25519KeyHash.from_bytes(paymentPubKey.hash().to_bytes())),
    Credential.from_keyhash(Ed25519KeyHash.from_bytes(stakePubKey.hash().to_bytes()))
  );

  const address = baseAddr.to_address().to_bech32();
  const addressBytes = baseAddr.to_address().to_bytes();

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

  return { address, signatureHex };
}

async function main() {
  const walletsDir = path.join(__dirname, '..', 'cardano_wallets');
  
  console.log('='.repeat(80));
  console.log('🚀 BẮT ĐẦU DONATE TỪ VÍ 1 -> 100 VỀ VÍ 1');
  console.log('='.repeat(80));
  console.log(`📁 Đọc wallets từ: ${walletsDir}`);
  console.log(`🎯 Destination: ${destination}`);
  console.log('='.repeat(80));

  let successCount = 0;
  let errorCount = 0;
  let skipCount = 0;

  for (let i = 1; i <= 100; i++) {
    const walletNumber = String(i).padStart(3, '0');
    const walletFile = path.join(walletsDir, `mining_wallet_${walletNumber}.json`);

    if (!fs.existsSync(walletFile)) {
      console.log(`\n⚠️  Wallet ${walletNumber}: File không tồn tại - SKIP`);
      skipCount++;
      continue;
    }

    try {
      const walletInfo: WalletInfo = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
      
      console.log(`\n${'='.repeat(80)}`);
      console.log(`💼 Wallet ${walletNumber}: ${walletInfo.name}`);
      console.log(`📍 Address: ${walletInfo.address}`);

      // Kiểm tra số dư
      let nightAllocation = 0;
      try {
        const { data: night } = await axios.get(`${BASE_URL}/statistics/${walletInfo.address}`);
        nightAllocation = +Number(night?.local?.night_allocation) / 1_000_000;
        console.log(`💰 Night Allocation: ${nightAllocation.toFixed(6)}`);

        if (nightAllocation === 0) {
          console.log(`⚠️  Wallet ${walletNumber}: Không có số dư - SKIP`);
          skipCount++;
          continue;
        }
      } catch (error) {
        console.log(`⚠️  Wallet ${walletNumber}: Không lấy được thông tin - SKIP`);
        skipCount++;
        continue;
      }

      const { address, signatureHex } = await processWallet(walletInfo);

      if (address !== walletInfo.address) {
        console.log(`❌ Wallet ${walletNumber}: Address không khớp - SKIP`);
        errorCount++;
        continue;
      }

      // Retry logic cho donate request
      let retryCount = 0;
      const maxRetries = 3;
      let donateSuccess = false;

      while (retryCount < maxRetries && !donateSuccess) {
        try {
          const donateUrl = `${BASE_URL}/donate_to/${destination}/${address}/${signatureHex}`;
          
          if (retryCount > 0) {
            console.log(`🔄 Retry ${retryCount}/${maxRetries}...`);
            await sleep(5000); 
          }

          const { data } = await axios.post(
            donateUrl,
            {},
            {
              headers: {
                'Content-Type': 'application/json',
              },
            }
          );
          
          console.log(`✅ Wallet ${walletNumber}: DONATE THÀNH CÔNG!`);
          console.log(`   Solutions: ${data.solutions_consolidated}`);
          console.log(`   Response:`, JSON.stringify(data, null, 2));
          console.log(`   Donation ID: ${data.donation_id}`);
          successCount++;
          donateSuccess = true;

        } catch (error: any) {
          const errorData = error.response?.data;
          
          // Nếu đã donate rồi (409) thì skip
          if (error.response?.status === 409) {
            console.log(`⚠️  Wallet ${walletNumber}: Đã donate trước đó - SKIP`);
            
            skipCount++;
            donateSuccess = true; // Không retry
            break;
          }
          
          // Nếu lỗi "Unable to verify" thì retry
          if (errorData?.message?.includes('Unable to verify')) {
            retryCount++;
            if (retryCount < maxRetries) {
              console.log(`⏳ Server busy, đợi ${5 * retryCount}s rồi thử lại...`);
              continue;
            }
          }
          
          // Lỗi khác
          console.log(`❌ Wallet ${walletNumber}: LỖI!`);
          console.log(`   Error:`, errorData || error.message);
          errorCount++;
          break;
        }
      }

      // Delay giữa các wallet (3-5s random)
      const delayMs = 3000 + Math.random() * 2000;
      console.log(`⏱️  Đợi ${(delayMs/1000).toFixed(1)}s trước khi xử lý wallet tiếp theo...`);
      await sleep(delayMs);

    } catch (error: any) {
      console.log(`❌ Wallet ${walletNumber}: LỖI NGHIÊM TRỌNG!`);
      console.log(`   Error:`, error.message);
      errorCount++;
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 KẾT QUẢ TỔNG HỢP');
  console.log(`${'='.repeat(80)}`);
  console.log(`✅ Thành công: ${successCount} wallets`);
  console.log(`⚠️  Bỏ qua: ${skipCount} wallets`);
  console.log(`❌ Thất bại: ${errorCount} wallets`);
  console.log(`📝 Tổng cộng: ${successCount + skipCount + errorCount} wallets`);
  console.log(`${'='.repeat(80)}`);
  console.log('🎉 HOÀN THÀNH!');
}

main();