## Ronin Restake

This is a project that restakes rewards on Ronin, without going to the web browser interface to do so.
It does this by using your private key, the given X_API_KEY and calling the restakeRewards function on the AXS Contract.

Create a file named .env and insert these keys:  

* private_key
* X_API_KEY
* AXS_CONTRACT_ADDR

X_API_KEY needs to be generated from the 
[Ronin Developer Console](https://developers.skymavis.com/console/applications/).

private_key is your wallet's private key.

# Format of .env file

private_key=0xabcdef.....  
X_API_KEY=....  
AXS_CONTRACT_ADDR=0x05b0bb3c1c320b280501b86706c3551995bc8571  

See also [env.sample](env.sample).

Chee-Wee, Chua,  
11-12 Oct 2024  

