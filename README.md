```bash
git clone https://github.com/longdevbf/Collect_Night
<<<<<<< HEAD
npm instal
=======
npm install axios @meshsdk/core @emurgo/cardano-serialization-lib-nodejs cbor fs path
>>>>>>> 71984cb7a89fed6f34ad5bfa59f9f9c540607b02
```

```typescript
const destination = ""; //cho địa chỉ đích vào (nghĩa là ví này sẽ nhận được night từ ví khác) 
//<lưu ý> : ví nhận cũng phải là ví đã đăng kí đào night và không phải là ví đã bị gom

const walletsDir = path.join(__dirname, '..', 'cardano_wallets');
//thay cái cụm cardano_wallets bằng folder chứa các file json của ví.
const walletFile = path.join(walletsDir, `mining_wallet_${walletNumber}.json`);
//Ví dụ: các file trong folder chứa các ví đó có tên là mining_wallet_${walletNumber}.json
```bash
npx tsx src/api.ts
```