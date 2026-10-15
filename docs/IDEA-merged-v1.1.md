# AEGIS Treasury: Master Project Context (v1.1, gabungan)

**FinTechathon 2026 · International AI Track · Topic F**

## AEGIS Treasury

**Risk-Aware Autonomous Treasury with Verifiable On-Chain Execution and Bank Oversight**

*An AI Treasury Agent That Knows When to Earn, When to Protect, and When Not to Act.*

Versi ini menggabungkan Master Project Context v1.0 dengan hasil riset tambahan tim. Bagian yang merupakan tambahan ditandai dengan **(baru)**.

## 1. Executive summary

AEGIS Treasury adalah platform AI Agent untuk mengelola aset treasury berbasis stablecoin dan tokenized deposit secara cerdas, adaptif, transparan, dan terkendali.

AEGIS membantu pengguna menentukan berapa dana yang harus disimpan sebagai cadangan likuid, berapa dana yang boleh dialokasikan ke vault deposito berjangka, kapan perlu menyeimbangkan kembali portofolio, dan kapan eksposur harus dikurangi karena risiko meningkat.

Berbeda dari dashboard DeFi biasa, AEGIS dapat menyusun rencana dan menjalankan transaksi melalui smart wallet. Berbeda pula dari AI trading bot yang diberi akses langsung ke wallet, setiap tindakannya harus melewati verifikasi kebijakan yang independen dari LLM.

**(baru)** AEGIS kini memiliki dua pengguna utama: pelaku usaha yang mengelola treasury, dan bank yang mengawasi seluruh AI Agent nasabahnya melalui Bank Risk Desk.

Konsep utamanya:

> AEGIS does not simply maximize returns. It protects financial obligations, manages risk, and executes only verifiably authorized decisions, under the oversight of the bank.

### Lima nilai utama AEGIS

**Liquidity First**
Melindungi dana yang dibutuhkan untuk pembayaran dan operasional sebelum mengalokasikan dana.

**Intelligent Decisions**
Menganalisis risiko, peluang, dan skenario sebelum menyusun keputusan finansial.

**Verifiable Execution**
Transaksi harus memiliki bukti otorisasi, hasil simulasi, dan validasi kebijakan yang sah.

**Adaptive Protection**
Strategi dievaluasi kembali ketika kondisi risiko berubah, termasuk memilih tidak melakukan transaksi.

**Institutional Oversight (baru)**
Bank dapat menetapkan kebijakan, memantau, menyetujui eskalasi, dan menghentikan AI Agent kapan saja.

AEGIS ditujukan terutama untuk **UMKM dan bisnis digital yang memegang stablecoin atau tokenized deposit untuk operasional lintas negara** dan memiliki kewajiban pembayaran nyata, bukan investor yang sekadar mencari APY tertinggi. **(baru)** Penyesuaian dari target awal (startup Web3 dan DAO kecil) ini dilakukan agar lebih sesuai dengan karakter juri WeBank: pemenang FinTechathon 2022 sampai 2025 tidak ada yang berbasis DeFi, dan sebagian besar menggunakan teknologi sponsor seperti FATE dan FISCO BCOS.

Untuk kompetisi, produk ini didemonstrasikan melalui testnet dan lingkungan simulasi yang terkontrol. Visi jangka panjangnya adalah sistem treasury non-custodial yang dapat diintegrasikan ke infrastruktur perbankan digital setelah melewati audit keamanan dan pemeriksaan regulasi.

## 2. Masalah yang ingin diselesaikan

**Problem 1: Idle Capital vs Liquidity Needs**
Dana stablecoin yang menganggur memiliki biaya peluang, tetapi menempatkan terlalu banyak dana dapat mengurangi kemampuan memenuhi kewajiban operasional seperti gaji dan pembayaran vendor.

**Problem 2: Dynamic and Interconnected Risks**
Vault, stablecoin, smart contract, oracle, dan likuiditas mempunyai risiko yang terus berubah. Imbal hasil tinggi tidak otomatis berarti strategi aman.

**Problem 3: Autonomous Execution Without Reliable Authorization**
Agent dapat menghasilkan transaksi yang keliru, dimanipulasi melalui prompt injection, atau bertindak berdasarkan informasi yang sudah kedaluwarsa. **(baru)** Kerugian nyata sudah terjadi: Freysa (sekitar USD 47 ribu, November 2024), Lobstar Wilde (sekitar USD 440 ribu akibat kesalahan satuan, Februari 2026), serta Grok dan Bankr (wallet dikuras melalui prompt berkode Morse, Mei 2026).

**Problem 4: Lack of Financial Decision Accountability**
Mengetahui bahwa suatu transaksi berhasil dilakukan tidak sama dengan mengetahui mengapa transaksi tersebut diizinkan, atas mandat siapa, dan berdasarkan kondisi risiko seperti apa.

**Problem 5: No Institutional Visibility (baru)**
Bank sebagai penyedia layanan keuangan belum memiliki visibilitas maupun kendali atas tindakan AI Agent terhadap dana nasabah. Kebutuhan ini mulai terlihat di industri: pada 9 Oktober 2026, HSBC dan Ant Digital menguji pembayaran AI Agent menggunakan tokenized deposit, dengan pemeriksaan risiko dijalankan oleh pihak bank.

Research gap yang akan kita kejar:

> How can an autonomous financial agent optimize treasury liquidity and risk-adjusted allocation while ensuring that every action remains authorized under the financial conditions that justified it, and remains overseeable by the bank?

## 3. Temuan benchmarking yang sangat penting

Sebagian besar fungsi dasar AI Treasury Agent ternyata sudah ada di pasar.

### Benchmark paling dekat: Aumo

Aumo (live di X Layer, kode berlisensi MIT di GitHub) sudah menawarkan autonomous stablecoin treasury, risk-adjusted yield selection, alokasi modal otomatis, smart-contract guardrails, monitoring risiko, dan decision receipts yang dapat ditelusuri on-chain. LLM pada Aumo juga hanya dapat membuat rencana lebih konservatif.

Ini berarti risk scoring, auto-rebalancing, allowlist, caps, dan decision receipts tidak cukup unik jika berdiri sendiri.

### (baru) Peserta lain di kompetisi ini

Dari repositori publik, peserta Topic F lain yang terlihat sejauh ini membangun wallet untuk pembayaran: tagihan mahasiswa (Leash), escrow kontraktor UMKM (agentic-wallet), belanja dengan mandat (xizo13/webank), dan pembayaran API melalui x402 (edxzh/agent-wallet). Belum ada yang berfokus pada pengelolaan aset.

### Penajaman konsep

**Dari:** AI-powered autonomous stablecoin yield optimizer.

**Menjadi:** Obligation-aware treasury agent with state-bound transaction authorization, verifiable decision evidence, and bank oversight.

Empat pembeda yang harus dirancang secara eksplisit:

1. **Obligation-aware treasury:** mengelola cadangan berdasarkan jadwal kewajiban pembayaran nyata.
2. **State-bound authorization:** otorisasi mengikat intent, calldata, versi keputusan risiko, dan kondisi finansial; tindakan ditahan ketika prasyarat tidak lagi terpenuhi.
3. **Decision accountability:** setiap tindakan dapat ditelusuri dari mandat pengguna hingga transaksi akhir, termasuk alasan penolakan.
4. **Bank oversight (baru):** bank menetapkan kebijakan per nasabah, menyetujui eskalasi, dan memiliki kill switch atas setiap agent.

## 4. Master document

Dokumen yang menjadi sumber bersama tim:

- **AEGIS Treasury: Master Context v1.0** (Stanley): DOCX dan MD di Notion tim.
- **AEGIS Treasury: Master Context v1.1** (dokumen ini): versi gabungan dengan Bank Risk Desk, penyesuaian target pengguna, dan ruang lingkup enam hari.
- **IDEA-merged-en.md:** versi bahasa Inggris untuk technical documentation dan pitch deck.

## 5. Benchmark kompetitor yang harus menjadi acuan tim

| Benchmark | Kekuatan yang sudah ada | Arah upgrade AEGIS |
|---|---|---|
| Aumo | Autonomous yield allocation, risk scoring, guardrails, decision receipts | Kewajiban kas yang eksplisit, otorisasi terikat kondisi, pengawasan bank |
| Giza ARMA (berhenti beroperasi Februari 2026) | Continuous AI DeFi optimization, session keys | Financial-obligation planning, evidence-based authorization |
| kpk vaults di Morpho (baru) | Rebalancing Agent dan Exit Agent deterministik dengan permission terbatas | Lapisan penjelasan AI, kewajiban, dan Bank Risk Desk |
| Theoriq AlphaVault (baru) | "Policy cage": AI hanya mengusulkan di dalam batas on-chain | Batas ditetapkan dan diawasi oleh bank |
| Yearn Finance | Automated yield strategies, allocator, rebalancing | Treasury management yang berpusat pada kebutuhan pengguna |
| Morpho | Vault curation, exposure caps, allocator dan sentinel | Lapisan agent untuk keputusan lintas mandat dan verifikasi sebelum eksekusi |
| DeFi Saver | Automated position management, stop-loss | Kewajiban treasury, konteks keputusan, dan bukti otorisasi |
| Coinbase Agentic Wallets | Autonomous wallets, spending limits | Financial intelligence dan risk-bound action planning |
| Safe Smart Accounts | Multisig, modules, guards, programmable permissions | Dipakai langsung sebagai execution layer (baru) |
| PACE (paper, Agustus 2026) | Typed intent, signed PDR, policy and transaction binding | Risk-context validation, obligation-aware decisions, pembuktian eksperimen |
| HSBC x Ant Digital (baru, Oktober 2026) | Pembayaran AI Agent dengan tokenized deposit, risk check oleh bank | Dari pembayaran ke pengelolaan treasury |

Kapabilitas pada tabel didasarkan pada dokumentasi produk dan penelitian terkait. Kolom upgrade merupakan usulan diferensiasi AEGIS, bukan klaim bahwa seluruh produk lain pasti tidak memiliki fitur tersebut.

Saya ingin menekankan satu hal: jangan menjadikan multi-agent, AI reasoning, atau risk scoring sebagai satu-satunya klaim inovasi. Pembeda yang paling layak dikejar adalah bagaimana financial obligations, dynamic risk, transaction authorization, dan bank oversight digabungkan dalam satu mekanisme yang secara kuantitatif lebih baik dan lebih aman pada skenario yang dapat diuji.

## 6. Struktur sistem final yang saya rekomendasikan

**AEGIS End-to-End Architecture**

**User Mandate + Treasury Obligations**
Risk limits · Reserve requirements · Due payments · Approvals

**Bank Policy (baru)**
Approved vaults · Limits per nasabah · Reserve rules · Kill switch

**Financial Engine**
Reserves · Deployable balance · Allocation

**Risk Intelligence**
Peg · Liquidity · Oracle staleness · Concentration

**AI Treasury Agent**
Understand context · Compare scenarios · Propose actions (hanya boleh lebih konservatif)

**Independent Security Verification**
Deterministic policies · Simulation · Signed state-bound authorization

**Smart Wallet / On-Chain Guard**
Safe + allowance module + Zodiac Roles + guard contract

**Execute**
Authorized transaction

**Reject**
Unsafe or invalid action

**Exit Agent (baru)**
Penarikan otomatis ke cadangan saat depeg, liquidity stress, atau oracle staleness

**Verifiable Decision Ledger + Bank Risk Desk**
Evidence · Policy hash · Approval · Transaction receipt · Pemantauan bank

Arsitektur target yang diusulkan, bukan sistem yang sudah di-deploy atau diaudit. Model AI tidak seharusnya menjadi otoritas terakhir untuk perhitungan finansial maupun izin memindahkan dana.

**(baru)** Untuk mempercepat implementasi, smart wallet menggunakan Safe beserta allowance module dan Zodiac Roles yang sudah tersedia di testnet. Kontrak custom hanya dibuat untuk guard yang memvalidasi state-bound authorization. Evidence utama berada di Base Sepolia, dengan opsi deployment ke FISCO BCOS untuk menunjukkan kesesuaian dengan teknologi WeBank.

## 7. Fitur inti yang harus benar-benar terlihat dalam produk

**Treasury Intelligence**
Treasury dashboard, obligations calendar, reserve planning, deployable balance, protocol risk radar, allocation simulation, dan AI chat untuk menjelaskan keputusan.

**Autonomous Decision & Execution**
Mandate builder, constrained strategy planning, automatic rebalancing, risk-triggered protective actions melalui Exit Agent, transaction simulation, approval tiers, dan smart-wallet execution.

**Security, Evidence & Governance**
Deterministic policy engine, state-bound authorization records, nonce and expiry protection, on-chain guard, audit ledger, explanation provenance, emergency pause, dan adversarial stress testing.

**Bank Risk Desk (baru)**
Daftar nasabah dan agent, risk score per agent, policy per nasabah, antrean approval eskalasi, audit log, dan kill switch.

Fitur yang perlu ditunda dari MVP adalah multi-chain treasury, strategi DeFi yang kompleks, protokol dengan leverage, pengelolaan dana riil pihak ketiga, serta integrasi bisnis yang memerlukan lisensi atau persetujuan khusus.

## 8. Contoh skenario yang menjadi pusat demo

**AEGIS Treasury Stress Scenario** (simulated)

- Total Treasury: **10.000 USDC**
- Required Reserve: **4.500 USDC**

Kondisi simulasi:

1. **Normal:** peluang alokasi tersedia.
2. **Risk Shock:** depeg atau likuiditas vault menurun, Exit Agent menarik dana ke cadangan.
3. **Obligation Shock:** tagihan baru jatuh tempo, agent melakukan rebalancing agar kewajiban tetap tertutup.
4. **Security Attack:** calldata diubah, record di-replay atau kedaluwarsa, serta prompt injection. Seluruhnya ditolak on-chain.
5. **Bank Intervention (baru):** risk officer menekan kill switch dan role agent dicabut.

**Allocation Planning:** AEGIS menyisihkan 4.500 USDC untuk kewajiban dan buffer, kemudian mengevaluasi maksimal 5.500 USDC sebagai modal yang berpotensi dialokasikan. Alokasi aktual bisa lebih rendah sesuai batas risiko.

Contoh angka dan respons adalah desain demonstrasi, bukan hasil performa sistem atau protokol nyata. Seluruh skenario harus menghasilkan transaction hash asli sebagai execution evidence.

Demo yang kuat harus memperlihatkan lebih dari transaksi berhasil. Juri perlu melihat kondisi ketika AEGIS berhasil menolak tindakan yang tidak lagi sah, beserta bukti teknis penolakannya.

## 9. Bagaimana kita membuktikan AEGIS lebih kuat?

| Dimensi | Metrik utama |
|---|---|
| Financial effectiveness | Net return after cost, liquidity shortfall, obligation coverage |
| Risk management | Drawdown, exposure concentration, risk-response time |
| Authorization security | Unauthorized execution rate, replay rejection, stale authorization rejection |
| Adversarial robustness (baru) | Hasil attack suite AgentDojo dan CrAIBench |
| Reliability | Successful authorized execution, false rejection, simulation failures |
| Explainability | Evidence completeness, decision traceability, factual consistency |
| Efficiency | Gas overhead, decision latency, unnecessary rebalancing |

Eksperimen sebaiknya membandingkan AEGIS dengan baseline idle cash, naive APY maximization, static allocation, serta konfigurasi authorization yang tidak mempunyai risk-context validation.

## 10. Versi ringkas untuk briefing tim

**AEGIS Treasury: Project Master Brief**

**Project Title:** AEGIS Treasury: Risk-Aware Autonomous Treasury with Verifiable On-Chain Execution and Bank Oversight

**Competition:** FinTechathon 2026, International AI Track, Topic F: Agent Wallet

**Tagline:** Know When to Earn, When to Protect, and When Not to Act.

**Project Overview**
AEGIS Treasury adalah platform AI Agent non-custodial yang membantu pelaku usaha mempertahankan likuiditas, mengoptimalkan penggunaan dana yang tersedia, mengelola risiko secara adaptif, dan melaksanakan tindakan finansial dengan otorisasi yang dapat diverifikasi, di bawah pengawasan bank.

**Problem Statement**
Pengelolaan treasury stablecoin dan tokenized deposit menghadapi empat tantangan utama: keseimbangan antara likuiditas dan imbal hasil, perubahan risiko secara dinamis, risiko memberikan kewenangan transaksi kepada AI Agent, serta belum adanya visibilitas bank atas tindakan AI Agent.

**Target Users**
UMKM dan bisnis digital yang menggunakan stablecoin atau tokenized deposit untuk operasional, serta bank yang menyediakan layanan tersebut.

**Proposed Solution**
1. Financial Intelligence: memahami posisi aset, kebutuhan kas, kewajiban pembayaran, risiko, dan dana yang dapat dialokasikan.
2. Autonomous Treasury Decisions: membandingkan strategi, melakukan simulasi, mengidentifikasi perubahan risiko, serta mengusulkan rebalancing atau tindakan perlindungan.
3. Verifiable On-Chain Execution: memastikan setiap tindakan memenuhi policy, batas risiko, otorisasi, dan hasil simulasi yang independen dari LLM.
4. Bank Oversight: bank menetapkan kebijakan, menyetujui eskalasi, dan dapat menghentikan agent.

**Key Features**
Treasury Overview Dashboard · Mandate Builder · Obligations & Liquidity Planning · AI Treasury Copilot · Protocol Risk Radar · Allocation Planner · Autonomous Rebalancing · Exit Agent · Transaction Simulation · Deterministic Policy Engine · State-Bound Authorization Records · On-Chain Guard · Decision & Audit Ledger · Stress Lab · Bank Risk Desk

**Technical Differentiation**
Obligation-aware treasury optimization, risk-context-bound transaction authorization, verifiable decision accountability, dan institutional oversight. PACE digunakan sebagai referensi policy-attested execution; Aumo, Giza, kpk, Morpho, dan Coinbase Agentic Wallets menjadi benchmark produk terkait.

**AI Architecture**
LLM menangani interpretasi permintaan, perencanaan, dan penjelasan, serta hanya dapat membuat rencana lebih konservatif. Deterministic financial engine menghitung cadangan dan alokasi. Policy engine menguji kelayakan tindakan. Smart contract menegakkan otorisasi. LLM tidak diberikan kewenangan langsung untuk menandatangani atau mengirim transaksi.

**MVP Scope**
Satu EVM testnet (Base Sepolia), satu stablecoin simulasi, dua vault uji (ERC-4626), mock price feed, Safe + Zodiac Roles + guard contract, satu service Python, satu aplikasi React (halaman pelaku usaha dan Bank Risk Desk). Komponen seperti Redis, BullMQ, NestJS, dan CVXPY ditunda kecuali waktu memungkinkan.

**Validation and Impact**
Evaluasi mencakup obligation coverage, efektivitas setelah biaya, respons terhadap risiko, keberhasilan transaksi sah, penolakan transaksi tidak sah, hasil attack suite, dan kelengkapan bukti audit. AEGIS tidak menjamin keuntungan, keamanan dana, maupun keberhasilan withdrawal dalam setiap kondisi.

**Long-Term Vision**
Treasury control plane bagi bisnis digital dan bank, dengan multi-wallet management, institutional policy controls, dan enterprise reporting. Implementasi dengan aset nyata hanya dilakukan setelah audit keamanan dan pemeriksaan regulasi.

**Core Message:** AEGIS makes autonomous finance accountable, not unrestricted.

## Kesimpulan strategis

Saya tetap melihat AEGIS sebagai proyek yang layak diperjuangkan untuk Topic F. Penambahan Bank Risk Desk, penyesuaian target pengguna ke UMKM dan tokenized deposit, serta pemanfaatan Safe, Zodiac Roles, dan desain Exit Agent kpk membuat konsep ini lebih sesuai dengan karakter juri WeBank sekaligus lebih realistis untuk diselesaikan dalam enam hari.

Sebelum implementasi dimulai, tim perlu menyepakati empat hal:

1. **Nama produk.** "Aegis Protocol V5" sudah digunakan oleh proyek agent firewall pada Chainlink Hackathon 2026. Apakah nama AEGIS tetap digunakan?
2. **Target pengguna.** UMKM dan bisnis digital (rekomendasi dokumen ini) atau startup Web3 dan DAO kecil (versi v1.0)?
3. **Penggunaan kode Aumo.** Lisensi MIT memperbolehkan penggunaan dengan atribusi, tetapi saya merekomendasikan hanya mempelajari desainnya agar klaim inovasi tetap kuat.
4. **Penanggung jawab smart contract.** Minimal satu anggota tim harus menguasai Solidity dan viem.

## Referensi

- AEGIS Treasury Master Context v1.0 (Stanley): https://stanley-n-wijaya.notion.site/FinTechathon-2026-3f973555b71f80519d41feb367d69e89
- Aumo: https://aumo.finance/ dan https://github.com/cryptoduke01/aumo
- kpk agent-powered vaults: https://chainwire.org/2025/11/13/kpk-launches-agent-powered-vaults-on-morpho/
- Theoriq AlphaVault: https://chainwire.org/2025/12/05/theoriq-launches-alphavault-with-ai-powered-active-management/
- Safe AI agent with spending limit: https://docs.safe.global/home/ai-agent-quickstarts/agent-with-spending-limit
- Zodiac Roles Modifier: https://github.com/gnosisguild/zodiac-modifier-roles
- PACE: https://arxiv.org/abs/2608.17220
- Signing the Transaction but Not the Decision: https://arxiv.org/abs/2609.11757
- HSBC x Ant Digital: https://www.prnewswire.com/apac/news-releases/ant-digital-technologies-and-hsbc-announce-successful-ai-agent-micropayment-technical-verification-test-302903333.html
- Lobstar Wilde: https://www.kucoin.com/news/flash/ai-agent-lobstar-wilde-loses-440-000-in-solana-transfer-error
- Bankr: https://cointelegraph.com/news/bankr-disables-transactions-after-14-wallets-hacked
- Aegis Protocol V5: https://chain.link/hack-26/projects/aegis-protocol-v5
- Pemenang FinTechathon sebelumnya: https://fintechathon.g-ican.com/#/past/2025
