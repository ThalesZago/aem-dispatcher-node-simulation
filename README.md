# aem-dispatcher-node-simulation
Repository to simulate AEM Dispatcher behavior using node js

Authorized Request: curl -i -u admin:admin http://localhost:8080/bin/wknd/authorized-demo.json
Non-Authorized Request: curl -i http://localhost:8080/bin/wknd/authorized-demo.json

$env:ALLOW_AUTHORIZED="1" - Run this command to change the ALLOW_AUTHORIZED variable (1 for true, 0 for false)

node ./proxy.js - Run this command to execute node server
