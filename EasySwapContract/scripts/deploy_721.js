const { ethers, upgrades } = require("hardhat")

// Compiled 1 Solidity file successfully (evm target: paris).
// deployer:  0x0eD4b67d787bB1a47E06F0C6927C223FFd2cB6BC
// testERC721 contract deployed to: 0x567E645b22d6aB60C43C35B0922669D82e3A3661

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log("deployer: ", deployer.address)

  // let TestERC721 = await ethers.getContractFactory("Troll")
  // const testERC721 = await TestERC721.deploy()
  // await testERC721.deployed()
  // console.log("testERC721 contract deployed to:", testERC721.address)

  // mint
  let testERC721Address = "0x567E645b22d6aB60C43C35B0922669D82e3A3661";
  let testERC721 = await (await ethers.getContractFactory("Troll")).attach(testERC721Address)
  tx = await testERC721.mint(deployer.address, 10);
  await tx.wait()
  console.log("mint tx:", tx.hash)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
