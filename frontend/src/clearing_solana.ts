/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/clearing_solana.json`.
 */
export type ClearingSolana = {
  "address": "DtFHUe9366drd6czf5hocSrWswr2DRT9YQhrbfQRmt15",
  "metadata": {
    "name": "clearingSolana",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancelObligation",
      "docs": [
        "Method must be called by both participants of obligation.",
        "Each will interact only with his 'cancel flag'.",
        "When both flags are true - only then obligation is considered as 'Canceled'."
      ],
      "discriminator": [
        8,
        215,
        42,
        243,
        93,
        138,
        61,
        138
      ],
      "accounts": [
        {
          "name": "fromParticipant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "from"
              }
            ]
          }
        },
        {
          "name": "toParticipant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "to"
              }
            ]
          }
        },
        {
          "name": "obligation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  98,
                  108,
                  105,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "from"
              },
              {
                "kind": "arg",
                "path": "to"
              },
              {
                "kind": "arg",
                "path": "timestamp"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "confirmObligation",
      "docs": [
        "Method to get configrmation by 'from participant' (the one that will have to pay obligation)."
      ],
      "discriminator": [
        239,
        247,
        122,
        143,
        81,
        120,
        200,
        109
      ],
      "accounts": [
        {
          "name": "fromParticipant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "from"
              }
            ]
          }
        },
        {
          "name": "toParticipant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "to"
              }
            ]
          }
        },
        {
          "name": "obligation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  98,
                  108,
                  105,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "from"
              },
              {
                "kind": "arg",
                "path": "to"
              },
              {
                "kind": "arg",
                "path": "timestamp"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createNewPool",
      "docs": [
        "Method that would be called when all the extisting pools are full.",
        "This method would be called by last participant,",
        "He will see a choice to pay for new pool, or wait till some pool is free",
        "Only after his confirmation to pay for pool this method is invoked"
      ],
      "discriminator": [
        109,
        248,
        159,
        179,
        84,
        8,
        104,
        168
      ],
      "accounts": [
        {
          "name": "lastPool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "lastPoolId"
              }
            ]
          }
        },
        {
          "name": "newPool",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lastPoolId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "createPoolManager",
      "docs": [
        "Method to create pool manager(dispatcher)"
      ],
      "discriminator": [
        38,
        62,
        59,
        114,
        227,
        161,
        221,
        74
      ],
      "accounts": [
        {
          "name": "rootPool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "poolManager",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108,
                  95,
                  109,
                  97,
                  110,
                  97,
                  103,
                  101,
                  114
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "declineObligation",
      "docs": [
        "Method to decline obligation if 'from participant' disagree with conditions"
      ],
      "discriminator": [
        166,
        138,
        27,
        119,
        5,
        194,
        141,
        231
      ],
      "accounts": [
        {
          "name": "fromParticipant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "from"
              }
            ]
          }
        },
        {
          "name": "toParticipant",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "to"
              }
            ]
          }
        },
        {
          "name": "obligation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  98,
                  108,
                  105,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "from"
              },
              {
                "kind": "arg",
                "path": "to"
              },
              {
                "kind": "arg",
                "path": "timestamp"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "finalizeClearingSession",
      "discriminator": [
        76,
        89,
        169,
        212,
        173,
        185,
        57,
        222
      ],
      "accounts": [
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "state.total_sessions",
                "account": "clearingState"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initEscrow",
      "docs": [
        "Method to init escrow account",
        "Must be invoked by admin"
      ],
      "discriminator": [
        70,
        46,
        40,
        23,
        6,
        11,
        81,
        139
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              }
            ]
          }
        },
        {
          "name": "admin",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "payFee",
      "docs": [
        "Method to pay fee of the session"
      ],
      "discriminator": [
        98,
        25,
        152,
        0,
        46,
        9,
        186,
        61
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              }
            ]
          }
        },
        {
          "name": "participant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "sessionId"
              }
            ]
          }
        },
        {
          "name": "netPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session"
              },
              {
                "kind": "account",
                "path": "participant"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "sessionId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "processObligation",
      "discriminator": [
        146,
        156,
        162,
        83,
        72,
        199,
        225,
        28
      ],
      "accounts": [
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "state.total_sessions",
                "account": "clearingState"
              }
            ]
          }
        },
        {
          "name": "obligation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  98,
                  108,
                  105,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "from"
              },
              {
                "kind": "arg",
                "path": "to"
              },
              {
                "kind": "arg",
                "path": "timestamp"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "obligation.pool_id",
                "account": "obligation"
              }
            ]
          }
        },
        {
          "name": "fromPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session"
              },
              {
                "kind": "account",
                "path": "obligation.from",
                "account": "obligation"
              }
            ]
          }
        },
        {
          "name": "toPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session"
              },
              {
                "kind": "account",
                "path": "obligation.to",
                "account": "obligation"
              }
            ]
          }
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "registerObligation",
      "docs": [
        "Method to create new obligation(from-to-amount)"
      ],
      "discriminator": [
        91,
        22,
        111,
        125,
        229,
        32,
        1,
        115
      ],
      "accounts": [
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "newObligation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  98,
                  108,
                  105,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "from"
              },
              {
                "kind": "arg",
                "path": "to"
              },
              {
                "kind": "arg",
                "path": "timestamp"
              }
            ]
          }
        },
        {
          "name": "participant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  111,
                  108
                ]
              },
              {
                "kind": "arg",
                "path": "poolId"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "from",
          "type": "pubkey"
        },
        {
          "name": "to",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "poolId",
          "type": "u32"
        }
      ]
    },
    {
      "name": "registerParticipant",
      "docs": [
        "Method to register new participant"
      ],
      "discriminator": [
        248,
        112,
        38,
        215,
        226,
        230,
        249,
        40
      ],
      "accounts": [
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "newParticipant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "nameRegistry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  110,
                  97,
                  109,
                  101,
                  95,
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "arg",
                "path": "name"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        }
      ]
    },
    {
      "name": "settlePosition",
      "discriminator": [
        33,
        156,
        74,
        218,
        215,
        42,
        112,
        175
      ],
      "accounts": [
        {
          "name": "session",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "arg",
                "path": "sessionId"
              }
            ]
          }
        },
        {
          "name": "netPosition",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "session"
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "obligation",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  98,
                  108,
                  105,
                  103,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              },
              {
                "kind": "arg",
                "path": "to"
              },
              {
                "kind": "arg",
                "path": "timestamp"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "startClearingSession",
      "discriminator": [
        220,
        214,
        199,
        126,
        198,
        223,
        150,
        241
      ],
      "accounts": [
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "session",
          "writable": true
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "totalObligations",
          "type": "u32"
        }
      ]
    },
    {
      "name": "updateFeeRate",
      "docs": [
        "Method to update fee rate,",
        "must be invoked by admin"
      ],
      "discriminator": [
        195,
        241,
        226,
        216,
        102,
        1,
        5,
        122
      ],
      "accounts": [
        {
          "name": "admin",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "state",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "newRateBps",
          "type": "u64"
        }
      ]
    },
    {
      "name": "updateParticipantLastSessionId",
      "discriminator": [
        232,
        200,
        188,
        211,
        189,
        39,
        253,
        184
      ],
      "accounts": [
        {
          "name": "participant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "participant"
              }
            ]
          }
        },
        {
          "name": "state",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "clearingEngine",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  103,
                  105,
                  110,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "updateUserType",
      "docs": [
        "Method to change user's type",
        "Can only be invoked by admin"
      ],
      "discriminator": [
        211,
        73,
        118,
        185,
        129,
        156,
        219,
        211
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "targetParticipant",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  114,
                  116,
                  105,
                  99,
                  105,
                  112,
                  97,
                  110,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "participant"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "userType",
          "type": {
            "defined": {
              "name": "userType"
            }
          }
        }
      ]
    },
    {
      "name": "withdrawFee",
      "docs": [
        "Method to Withdraw fee, can be invoked only by owner of escrow account(admin)"
      ],
      "discriminator": [
        14,
        122,
        231,
        218,
        31,
        238,
        223,
        150
      ],
      "accounts": [
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "clearingEngine",
      "discriminator": [
        18,
        243,
        63,
        46,
        131,
        151,
        16,
        121
      ]
    },
    {
      "name": "clearingSession",
      "discriminator": [
        165,
        159,
        252,
        217,
        154,
        205,
        39,
        60
      ]
    },
    {
      "name": "clearingState",
      "discriminator": [
        195,
        83,
        13,
        154,
        247,
        32,
        208,
        30
      ]
    },
    {
      "name": "escrow",
      "discriminator": [
        31,
        213,
        123,
        187,
        186,
        22,
        218,
        155
      ]
    },
    {
      "name": "nameRegistry",
      "discriminator": [
        169,
        63,
        83,
        240,
        198,
        158,
        53,
        11
      ]
    },
    {
      "name": "netPosition",
      "discriminator": [
        45,
        246,
        13,
        53,
        31,
        120,
        55,
        166
      ]
    },
    {
      "name": "obligation",
      "discriminator": [
        168,
        206,
        141,
        106,
        88,
        76,
        172,
        167
      ]
    },
    {
      "name": "obligationPool",
      "discriminator": [
        104,
        9,
        93,
        70,
        94,
        240,
        60,
        0
      ]
    },
    {
      "name": "participant",
      "discriminator": [
        32,
        142,
        108,
        79,
        247,
        179,
        54,
        6
      ]
    },
    {
      "name": "poolManager",
      "discriminator": [
        54,
        241,
        200,
        10,
        177,
        151,
        78,
        17
      ]
    }
  ],
  "events": [
    {
      "name": "escrowInitialized",
      "discriminator": [
        222,
        186,
        157,
        47,
        145,
        142,
        176,
        248
      ]
    },
    {
      "name": "feePaid",
      "discriminator": [
        159,
        12,
        52,
        212,
        249,
        36,
        24,
        18
      ]
    },
    {
      "name": "feeRateUpdated",
      "discriminator": [
        90,
        28,
        42,
        224,
        39,
        78,
        81,
        27
      ]
    },
    {
      "name": "feeWithdrawed",
      "discriminator": [
        97,
        148,
        156,
        74,
        62,
        237,
        65,
        144
      ]
    },
    {
      "name": "obligationCancelled",
      "discriminator": [
        4,
        56,
        49,
        39,
        121,
        209,
        221,
        112
      ]
    },
    {
      "name": "obligationConfirmed",
      "discriminator": [
        82,
        37,
        168,
        107,
        28,
        183,
        124,
        160
      ]
    },
    {
      "name": "obligationCreated",
      "discriminator": [
        138,
        94,
        71,
        44,
        75,
        151,
        171,
        71
      ]
    },
    {
      "name": "obligationDeclined",
      "discriminator": [
        108,
        19,
        200,
        151,
        110,
        117,
        154,
        167
      ]
    },
    {
      "name": "obligationNetted",
      "discriminator": [
        44,
        58,
        180,
        198,
        162,
        226,
        112,
        136
      ]
    },
    {
      "name": "participantRegistered",
      "discriminator": [
        47,
        115,
        159,
        109,
        135,
        121,
        70,
        193
      ]
    },
    {
      "name": "poolCreated",
      "discriminator": [
        202,
        44,
        41,
        88,
        104,
        220,
        157,
        82
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "unauthorized"
    },
    {
      "code": 6001,
      "name": "forbidden"
    },
    {
      "code": 6002,
      "name": "insufficientBalance"
    },
    {
      "code": 6003,
      "name": "insufficientFees"
    },
    {
      "code": 6004,
      "name": "mathOverflow"
    }
  ],
  "types": [
    {
      "name": "clearingEngine",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "clearingSession",
      "docs": [
        "Object of session, maily used for statistics"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "clearingSessionStatus"
              }
            }
          },
          {
            "name": "openedAt",
            "type": "i64"
          },
          {
            "name": "closedAt",
            "type": "i64"
          },
          {
            "name": "totalObligations",
            "type": "u32"
          },
          {
            "name": "processedCount",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "clearingSessionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "closed"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "failed"
          }
        ]
      }
    },
    {
      "name": "clearingState",
      "docs": [
        "Account for general state of system"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "totalSessions",
            "type": "u64"
          },
          {
            "name": "totalParticipants",
            "type": "u64"
          },
          {
            "name": "totalObligations",
            "type": "u64"
          },
          {
            "name": "feeRateBps",
            "type": "u64"
          },
          {
            "name": "updateTimestamp",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "escrow",
      "docs": [
        "Account for getting commissions from users of system",
        "Only admin can create this account (he is the owner)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "totalFees",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "escrowInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "escrow",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feePaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "participant",
            "type": "pubkey"
          },
          {
            "name": "sessionId",
            "type": "u64"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feeRateUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "oldRate",
            "type": "u64"
          },
          {
            "name": "newRate",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "feeWithdrawed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "nameRegistry",
      "docs": [
        "Account for saving users' names,",
        "uses can occupy name, so next will see it is used"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "nameBytes",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "participant",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "netPosition",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sessionId",
            "type": "u64"
          },
          {
            "name": "participant",
            "type": "pubkey"
          },
          {
            "name": "netAmount",
            "type": "i64"
          },
          {
            "name": "feeAmount",
            "type": "u64"
          },
          {
            "name": "feePaid",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "obligation",
      "docs": [
        "Obligation from participant A to participant B",
        "After creation it will be sticked to Pool X",
        "session_id is 0 by default, but will be assigned to X on clearing session",
        "from and to cancel flags are for cancelation before clearing session,",
        "after cancelation obligation will be removed from Pool"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "obligationStatus"
              }
            }
          },
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "sessionId",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "fromCancel",
            "type": "bool"
          },
          {
            "name": "toCancel",
            "type": "bool"
          },
          {
            "name": "poolId",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "obligationCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "obligation",
            "type": "pubkey"
          },
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "obligationConfirmed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "obligation",
            "type": "pubkey"
          },
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "obligationCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "obligation",
            "type": "pubkey"
          },
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "obligationDeclined",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "obligation",
            "type": "pubkey"
          },
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "obligationNetted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "obligation",
            "type": "pubkey"
          },
          {
            "name": "from",
            "type": "pubkey"
          },
          {
            "name": "to",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "obligationPool",
      "docs": [
        "Pool to keep obligations in one place,",
        "has references to neighbour Pools"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "obligations",
            "type": {
              "array": [
                "pubkey",
                100
              ]
            }
          },
          {
            "name": "occupied",
            "type": {
              "array": [
                "bool",
                100
              ]
            }
          },
          {
            "name": "occupiedCount",
            "type": "u8"
          },
          {
            "name": "nextPool",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "prevPool",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "obligationStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "created"
          },
          {
            "name": "confirmed"
          },
          {
            "name": "declined"
          },
          {
            "name": "netted"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "participant",
      "docs": [
        "Participant of system, can be Admin, User, Officer(Observer)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "userType",
            "type": {
              "defined": {
                "name": "userType"
              }
            }
          },
          {
            "name": "userName",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "userNameLen",
            "type": "u8"
          },
          {
            "name": "registrationTimestamp",
            "type": "i64"
          },
          {
            "name": "updateTimestamp",
            "type": "i64"
          },
          {
            "name": "lastSessionId",
            "type": "u64"
          },
          {
            "name": "nameRegistry",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "participantRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pariticipant",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "poolCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "id",
            "type": "u32"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "poolManager",
      "docs": [
        "Main account of Pools, have reference to Root Pool,",
        "which is the main pool"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "rootPool",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "userType",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "participant"
          },
          {
            "name": "admin"
          },
          {
            "name": "officer"
          }
        ]
      }
    }
  ]
};
