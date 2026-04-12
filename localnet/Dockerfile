FROM solanalabs/solana:v1.18.26

WORKDIR /app

RUN mkdir -p /app/ledger

EXPOSE 8899 8900

CMD ["solana-test-validator", "--ledger", "/app/ledger", "--rpc-port", "8899", "--reset"]
