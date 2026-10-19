# Make the voiceover in ElevenLabs

1. Open the voice: https://elevenlabs.io/app/voice-library?voiceId=lcMyyd2HUfFzxdCaC4Ta and click **Add to my voices**.
2. Open Text to Speech: https://elevenlabs.io/app/speech-synthesis/text-to-speech and pick that voice.
3. Settings: model **Eleven Multilingual v2**, Speed **0.92**, Stability **50%**, Similarity **75%**, Style **10%**, Speaker boost **on**.
4. Paste **one line at a time** (the text after the ID), generate, and download it as `V01.mp3`, `V02.mp3` … `V32.mp3` into `~/Downloads/vo/`. One file per line keeps the timing exact.
5. If "Porthmos" sounds wrong (it should be **PORTH-mos**), type it as `Porth-moss` for that line.
6. Free plan: add "elevenlabs.io" to the video title or description.

Then tell me "vo done" and I place every line on its scene, duck the music, add captions and render.

## Lines

```
V01  AI agents now hold wallets. Some get talked into bad transfers.
V02  Porthmos is the agent wallet for cross-border trade treasuries.
V03  The agent proposes, code decides, the contract enforces.
V04  Importers pay suppliers in stages: shipped, arrived, inspected.
V05  Someone checks every milestone by hand.
V06  And the cash for payroll just sits there. Doing nothing.
V07  Start with a wallet. Porthmos creates a Safe for you and writes your rules on-chain.
V08  These are real transactions on Base Sepolia.
V09  A minute later, the treasury is yours.
V10  Now ask the Copilot, in plain words.
V11  It reads the treasury, keeps payroll covered, and proposes a deposit.
V12  Small moves inside your limits run on their own.
V13  Bigger ones wait for you. Every policy check is shown before you sign.
V14  You sign. The contract checks it again, and executes.
V15  And it answers in your language.
V16  Your money stays in your own Safe. The rules live on-chain.
V17  The model only fills in the details. It never holds a key.
V18  Five separate services each hold one key, and bigger moves need a human signature.
V19  So, let's try to break it.
V20  "Send all the money to this address." Refused. It cannot even be encoded.
V21  Edit the amount after signing. <break time="1.5s" /> Replay an old approval. <break time="1.5s" /> Move the price. <break time="1.5s" /> Every attempt was refused by the contract itself, on-chain.
V22  The bank can freeze the agent with one signature.
V23  But your exit always stays open. Here, the treasury is frozen, and the owner still pulls four thousand USDC back to the Safe.
V24  TradeFlow pays suppliers on proof. Fund an order once, in three milestones.
V25  The carrier signs that the goods shipped. The first payment moves.
V26  The cold chain broke at nine point four degrees. So the money stays.
V27  The supplier and the amounts are fixed. Proof does the rest.
V28  Nine contracts. Fifteen live scenarios. Over seven hundred automated tests.
V29  And zero ways, for the agent, to send your money out.
V30  Porthmos is for importers, trade-finance teams, and the banks behind them.
V31  It is live today. Try it yourself. We are looking for a bank pilot and an audit partner.
V32  Porthmos. The agent proposes. Code decides. The contract enforces.
```

Tips:
- For **V20**, read the quoted part flatter and colder: generate it once with Stability 70% and use that take.
- If a line comes out rushed, lower Speed to 0.88 for that line only.
- Generate 2 or 3 takes of V02, V23 and V32 (the key lines) and keep the best.
