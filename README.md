# webtransport_ingest_tunnel
Webtransport tunnel for Live Video Ingest

To start the server, run "python3 webtransport_server.py cert.pem cert.key".

To start the client, launch Chromium from command line, "/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary --origin-to-force-quic-on=ec2-18-206-234-14.compute-1.amazonaws.com:4433 --ignore-certificate-errors-spki-list=zb0RdtaRcRMTpMRrzbt7WlC0L7Och1zWa73t8kv/pOQ=". To run the client and server on the same machine, use "localhost:4433" instead of your remote server address (e.g. "ec2-18-206-234-14.compute-1.amazonaws.com:4433").
