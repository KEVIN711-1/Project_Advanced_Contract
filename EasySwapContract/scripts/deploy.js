const { ethers, upgrades } = require("hardhat")

/**  * 2025/02/15 in sepolia testnet
 * esVault contract deployed to: 0xaD65f3dEac0Fa9Af4eeDC96E95574AEaba6A2834
     esVault ImplementationAddress: 0x5D034EA7F15429Bcb9dFCBE08Ee493F001063AF0
     esVault AdminAddress: 0xe839419C14188F7b79a0E4C09cFaF612398e7795
   esDex contract deployed to: 0xcEE5AA84032D4a53a0F9d2c33F36701c3eAD5895
      esDex ImplementationAddress: 0x17B2d83BFE9089cd1D676dE8aebaDCA561f55c96
      esDex AdminAddress: 0xe839419C14188F7b79a0E4C09cFaF612398e7795
 */
// .env
//   └─ PRIVATE_KEY
//       ↓
// hardhat.config.js
//   └─ accounts
//       ↓
// ethers.getSigners()
//   └─ deployer (Signer)
//       ↓
// deployProxy()
//   └─ initialize()
//       ↓
// msg.sender = deployer.address

// EasySwapVault{
//   esVault contract deployed to: 0x12522b4d3e283551021E04f40eF537d4e39A9F1F
//   0xa9AB2eb81681d52278D33c754f0C8B4De88083b3  esVault getImplementationAddress
//   0xf63B860CB3ea5Be0E489B72A730576024E370fd5  esVault getAdminAddress
// }

// EasySwapOrderBook{
// esDex contract deployed to: 0xCc5CA9A99d856a3506FB041559fa4516A1fCcb9C
// 0x86784284867e27d002c6DA63406f86F7Aa8f58d0  esDex getImplementationAddress
// 0xf63B860CB3ea5Be0E489B72A730576024E370fd5  esDex getAdminAddress
// }

// EasySwapVault{
// esVault setOrderBook tx: 0x6f4dd66b6aa4645a65d2debe3110cad927470dab1604b3ed1221bf9b4cab3159
// }

async function main() {
//   从私钥可以推导出公钥和地址
// 从公钥只能推导出地址，无法反推私钥
// 从地址什么也推导不出来
// 根据我的私钥获取我账户的地址
  const [deployer] = await ethers.getSigners()
  console.log("deployer: ", deployer.address)

  // let esVault = await ethers.getContractFactory("EasySwapVault")
  // esVault = await upgrades.deployProxy(esVault, { initializer: 'initialize' });
  // await esVault.deployed()
  // console.log("esVault contract deployed to:", esVault.address)
  // console.log(await upgrades.erc1967.getImplementationAddress(esVault.address), " esVault getImplementationAddress")
  // console.log(await upgrades.erc1967.getAdminAddress(esVault.address), " esVault getAdminAddress")

  // newProtocolShare = 200;
  // newESVault = "0x12522b4d3e283551021E04f40eF537d4e39A9F1F";
  // EIP712Name = "EasySwapOrderBook";
  // EIP712Version = "1";
  // let esDex = await ethers.getContractFactory("EasySwapOrderBook")
  // esDex = await upgrades.deployProxy(esDex, [newProtocolShare, newESVault, EIP712Name, EIP712Version], { initializer: 'initialize' });
  // await esDex.deployed()
  // console.log("esDex contract deployed to:", esDex.address)
  // console.log(await upgrades.erc1967.getImplementationAddress(esDex.address), " esDex getImplementationAddress")
  // console.log(await upgrades.erc1967.getAdminAddress(esDex.address), " esDex getAdminAddress")

  esDexAddress = "0xCc5CA9A99d856a3506FB041559fa4516A1fCcb9C"
  esVaultAddress = "0x12522b4d3e283551021E04f40eF537d4e39A9F1F"
  const esVault = await (
    await ethers.getContractFactory("EasySwapVault")
  ).attach(esVaultAddress)   // ← 不是部署新合约，而是连接到已有的

  // 2. 设置金库合约的 OrderBook 地址
  tx = await esVault.setOrderBook(esDexAddress)
  await tx.wait()
  console.log("esVault setOrderBook tx:", tx.hash)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
