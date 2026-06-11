## GitHub Copilot Chat

- Extension: 0.47.0 (prod)
- VS Code: 1.119.0 (8b640eef5a6c6089c029249d48efa5c99adf7d51)
- OS: win32 10.0.22621 x64
- GitHub Account: D-ai042

## Network

User Settings:
```json
  "http.systemCertificatesNode": true,
  "github.copilot.advanced.debug.useElectronFetcher": true,
  "github.copilot.advanced.debug.useNodeFetcher": false,
  "github.copilot.advanced.debug.useNodeFetchFetcher": true
```

Connecting to https://api.github.com:
- DNS ipv4 Lookup: 20.205.243.168 (45 ms)
- DNS ipv6 Lookup: Error (44 ms): getaddrinfo ENOTFOUND api.github.com
- Proxy URL: http://127.0.0.1:7897 (1 ms)
- Proxy Connection: 200 Connection established (2 ms)
- Electron fetch (configured): timed out after 10 seconds
- Node.js https: Error (5011 ms): Error: Client network socket disconnected before secure TLS connection was established
	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
	at TLSSocket.emit (node:events:531:35)
	at endReadableNT (node:internal/streams/readable:1698:12)
	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
- Node.js fetch: Error (7908 ms): TypeError: fetch failed
	at node:internal/deps/undici/undici:14902:13
	at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
	at async n._fetch (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5326:5229)
	at async n.fetch (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5326:4541)
	at async u (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5358:186)
	at async kg._executeContributedCommand (file:///f:/Microsoft%20VS%20Code/8b640eef5a/resources/app/out/vs/workbench/api/node/extensionHostProcess.js:503:48675)
  Error: Client network socket disconnected before secure TLS connection was established
  	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
  	at TLSSocket.emit (node:events:531:35)
  	at endReadableNT (node:internal/streams/readable:1698:12)
  	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)

Connecting to https://api.githubcopilot.com/_ping:
- DNS ipv4 Lookup: 140.82.113.21 (70 ms)
- DNS ipv6 Lookup: Error (32 ms): getaddrinfo ENOTFOUND api.githubcopilot.com
- Proxy URL: http://127.0.0.1:7897 (2 ms)
- Proxy Connection: 200 Connection established (1 ms)
- Electron fetch (configured): Error (10005 ms): Error: net::ERR_CONNECTION_CLOSED
	at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/utility_init:2:10684)
	at SimpleURLLoaderWrapper.emit (node:events:519:28)
  {"is_request_error":true,"network_process_crashed":false}
- Node.js https: Error (7860 ms): Error: Client network socket disconnected before secure TLS connection was established
	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
	at TLSSocket.emit (node:events:531:35)
	at endReadableNT (node:internal/streams/readable:1698:12)
	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
- Node.js fetch: Error (9652 ms): TypeError: fetch failed
	at node:internal/deps/undici/undici:14902:13
	at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
	at async n._fetch (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5326:5229)
	at async n.fetch (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5326:4541)
	at async u (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5358:186)
	at async kg._executeContributedCommand (file:///f:/Microsoft%20VS%20Code/8b640eef5a/resources/app/out/vs/workbench/api/node/extensionHostProcess.js:503:48675)
  Error: Client network socket disconnected before secure TLS connection was established
  	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
  	at TLSSocket.emit (node:events:531:35)
  	at endReadableNT (node:internal/streams/readable:1698:12)
  	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)

Connecting to https://copilot-proxy.githubusercontent.com/_ping:
- DNS ipv4 Lookup: 4.249.131.160 (42 ms)
- DNS ipv6 Lookup: Error (34 ms): getaddrinfo ENOTFOUND copilot-proxy.githubusercontent.com
- Proxy URL: http://127.0.0.1:7897 (1 ms)
- Proxy Connection: 200 Connection established (1 ms)
- Electron fetch (configured): Error (10004 ms): Error: net::ERR_CONNECTION_CLOSED
	at SimpleURLLoaderWrapper.<anonymous> (node:electron/js2c/utility_init:2:10684)
	at SimpleURLLoaderWrapper.emit (node:events:519:28)
  {"is_request_error":true,"network_process_crashed":false}
- Node.js https: Error (6716 ms): Error: Client network socket disconnected before secure TLS connection was established
	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
	at TLSSocket.emit (node:events:531:35)
	at endReadableNT (node:internal/streams/readable:1698:12)
	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
- Node.js fetch: Error (5007 ms): TypeError: fetch failed
	at node:internal/deps/undici/undici:14902:13
	at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
	at async n._fetch (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5326:5229)
	at async n.fetch (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5326:4541)
	at async u (f:\Microsoft VS Code\8b640eef5a\resources\app\extensions\copilot\dist\extension.js:5358:186)
	at async kg._executeContributedCommand (file:///f:/Microsoft%20VS%20Code/8b640eef5a/resources/app/out/vs/workbench/api/node/extensionHostProcess.js:503:48675)
  Error: Client network socket disconnected before secure TLS connection was established
  	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
  	at TLSSocket.emit (node:events:531:35)
  	at endReadableNT (node:internal/streams/readable:1698:12)
  	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)

Connecting to https://mobile.events.data.microsoft.com: HTTP 404 (289 ms)
Connecting to https://dc.services.visualstudio.com: timed out after 10 seconds
Connecting to https://copilot-telemetry.githubusercontent.com/_ping: Error (5852 ms): Error: Client network socket disconnected before secure TLS connection was established
	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
	at TLSSocket.emit (node:events:531:35)
	at endReadableNT (node:internal/streams/readable:1698:12)
	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
Connecting to https://copilot-telemetry.githubusercontent.com/_ping: Error (5007 ms): Error: Client network socket disconnected before secure TLS connection was established
	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
	at TLSSocket.emit (node:events:531:35)
	at endReadableNT (node:internal/streams/readable:1698:12)
	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)
Connecting to https://default.exp-tas.com: Error (8962 ms): Error: Client network socket disconnected before secure TLS connection was established
	at TLSSocket.onConnectEnd (node:_tls_wrap:1750:19)
	at TLSSocket.emit (node:events:531:35)
	at endReadableNT (node:internal/streams/readable:1698:12)
	at process.processTicksAndRejections (node:internal/process/task_queues:89:21)

Number of system certificates: 95

## Documentation

In corporate networks: [Troubleshooting firewall settings for GitHub Copilot](https://docs.github.com/en/copilot/troubleshooting-github-copilot/troubleshooting-firewall-settings-for-github-copilot).