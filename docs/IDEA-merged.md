# Porthmos (sebelumnya AEGIS Treasury): Master Project Context (v1.2, gabungan)

**FinTechathon 2026 · International AI Track · Topic F**

## AEGIS Treasury

**AI-Powered Trade Treasury & Conditional Settlement, with Verifiable On-Chain Execution and Bank Oversight**

*Manage Funds Intelligently. Pay Only When Proven. Protect Every Transaction.*

Versi ini menggabungkan Master Context v1.1 dengan dua dokumen baru tim: **AEGIS Treasury 2.0 (Autonomous & Verifiable Supply Chain Finance)** dan **Market & Business Feasibility Analysis (Oktober 2026)**. Bagian yang baru di versi ini ditandai **(baru, v1.2)**. Bagian yang sudah ada sejak v1.1 ditandai **(v1.1)** bila perlu.

Status implementasi ditulis jujur di setiap bagian: **[sudah dibangun]** berarti sudah berjalan dan teruji di repo, **[usulan]** berarti belum dibangun.

## 1. Executive summary

AEGIS Treasury adalah platform AI Agent untuk perusahaan yang mengelola dana stablecoin atau tokenized deposit. AEGIS menjaga dana yang dibutuhkan untuk kewajiban pembayaran, menempatkan sisa dana secara terkendali, dan **(baru, v1.2)** mengeksekusi pembayaran antarbisnis hanya ketika syarat transaksinya terbukti.

**(baru, v1.2)** Posisi produk berkembang dari "AI yang mengelola dana perusahaan" menjadi **AI Financial Agent yang mengelola likuiditas sekaligus mengotomatisasi pembayaran B2B berdasarkan bukti pemenuhan kontrak**. Use case pertama adalah **TradeFlow**: pembayaran importir ke eksportir per milestone pengiriman.

Kedua ide ini menyatu secara alami. Di TradeFlow, setiap pembayaran milestone ke pemasok adalah **kewajiban** (obligation). Reserve engine AEGIS yang sudah dibangun sudah memperlakukan kewajiban sebagai dana yang wajib tetap likuid dan tidak boleh diinvestasikan. Jadi escrow pemasok adalah kasus khusus dari obligation-aware reserve, bukan sistem baru yang terpisah.

Konsep utamanya:

> AEGIS helps a company's money move at the right time, to the right party, and only when the transaction's conditions can be proven, while keeping liquidity and security under control.

### Nilai utama AEGIS

**Liquidity First** (v1.1)
Melindungi dana untuk pembayaran dan operasional sebelum mengalokasikan dana lain.

**Pay Only When Proven (baru, v1.2)**
Dana milestone dilepas ke pemasok hanya setelah bukti pengiriman, kedatangan, atau penerimaan diverifikasi.

**Verifiable Execution** (v1.1)
Setiap transaksi punya bukti otorisasi, hasil simulasi, dan validasi kebijakan.

**Adaptive Protection** (v1.1)
Strategi dievaluasi ulang ketika risiko berubah, termasuk memilih tidak bertindak. Pembayaran yang belum dilepas ditahan jika bukti tidak valid.

**Institutional Oversight** (v1.1)
Bank menetapkan kebijakan, memantau, menyetujui eskalasi, dan dapat membekukan agent.

## 2. Masalah yang ingin diselesaikan

**Problem 1: Idle Capital vs Liquidity Needs** (v1.1)
Dana stablecoin yang menganggur punya biaya peluang, tetapi menempatkan terlalu banyak dana bisa membuat perusahaan gagal membayar gaji dan vendor.

**Problem 2: Pembayaran B2B tidak efisien (baru, v1.2)**
Pembeli dan pemasok menunggu pemeriksaan dokumen, konfirmasi pengiriman, dan persetujuan pembayaran secara manual.

**Problem 3: Kurangnya kepercayaan antar pihak (baru, v1.2)**
Pembeli takut membayar sebelum barang diterima. Pemasok takut tidak dibayar setelah kewajibannya selesai.

**Problem 4: Autonomous Execution Without Reliable Authorization** (v1.1)
Agent bisa membuat transaksi yang keliru, dimanipulasi lewat prompt injection, atau bertindak dengan data kedaluwarsa. Kerugian nyata sudah terjadi: Freysa (sekitar USD 47 ribu, November 2024), Lobstar Wilde (sekitar USD 440 ribu akibat kesalahan satuan, Februari 2026), Grok dan Bankr (Mei 2026).

**Problem 5: Keamanan, privasi, dan akuntabilitas (gabungan)**
Data bisnis dan transaksi bernilai besar harus diverifikasi tanpa membuka informasi sensitif secara berlebihan. Mengetahui transaksi berhasil tidak sama dengan mengetahui mengapa transaksi itu diizinkan dan atas mandat siapa.

**Problem 6: No Institutional Visibility** (v1.1)
Bank belum punya visibilitas maupun kendali atas tindakan AI Agent terhadap dana nasabah. Pada 9 Oktober 2026, HSBC dan Ant Digital menguji pembayaran AI Agent dengan tokenized deposit, dengan risk check oleh bank.

Pertanyaan inti:

> Bagaimana jika uang bisnis hanya boleh bergerak ketika pekerjaannya benar-benar terbukti selesai, dan setiap tindakan agent tetap terikat pada kondisi finansial yang membenarkannya?

## 3. Siapa pengguna AEGIS? (baru, v1.2)

| Peran | Persona | Kebutuhan |
|---|---|---|
| **Primary buyer** | Finance / Treasury Manager perusahaan importir (pasar awal: trading company di Singapura) | Kepastian pembayaran, visibilitas kewajiban kas, kontrol transaksi tanpa mengecek semua milestone manual |
| **Secondary user** | Supplier / Exporter | Kepastian dana pembeli sudah dicadangkan dan akan dilepas sesuai milestone yang disepakati |
| **Pengawas** | Bank risk officer (v1.1) | Kebijakan per nasabah, risk score, approval eskalasi, freeze dan revoke |
| **Distribution partner** | Freight forwarder, platform dokumen perdagangan elektronik (eBL), bank, penyedia pembayaran berizin | Integrasi AEGIS ke alur perdagangan yang sudah dipakai pelanggan |

Model awal yang disarankan adalah **buyer-paid**: importir membayar, pemasok mendapat portal gratis untuk melihat milestone, menyerahkan bukti, dan memantau status pembayaran.

**Mengapa Singapura dulu?** Statistik resmi Singapura mencatat 57.715 establishments di sektor wholesale trade pada 2024 (belum tentu perusahaan unik atau semuanya importir/eksportir). Singapura juga punya TradeTrust untuk dokumen perdagangan elektronik yang dapat diverifikasi, dan kerangka regulasi stablecoin dari MAS.

**Catatan Indonesia:** Bank Indonesia menyatakan kripto bukan alat pembayaran yang sah. Pengawasan aset kripto oleh OJK tidak membuat stablecoin sah sebagai alat pembayaran. Karena itu nilai perdagangan Indonesia tidak boleh dihitung langsung sebagai volume transaksi stablecoin AEGIS.

## 4. Problem-solution mapping (baru, v1.2)

| Masalah bisnis | Solusi AEGIS | Status |
|---|---|---|
| Dana menganggur atau tidak terencana | AI Treasury Management dengan obligation-aware reserve | [sudah dibangun] |
| Pemasok tidak yakin akan dibayar | Smart Escrow: dana milestone dikunci di TradeEscrow | [sudah dibangun], direkam di E6a |
| Pembeli takut membayar sebelum barang sesuai | Proof-Based Conditional Payment per milestone | [sudah dibangun], direkam di E6b sampai E6g (penerbit demo) |
| Dokumen dan identitas bisnis sensitif | Zero-Knowledge verification untuk syarat tertentu | [usulan, modul tambahan] |
| Pembayaran bertahap rumit dan manual | Programmable milestone release, opsi payment streaming | [usulan] |
| Transaksi berisiko atau mencurigakan | AI risk monitoring, Exit Agent, state-bound authorization, bank freeze | [sudah dibangun] |
| Agent bisa dimanipulasi | Structural containment: hanya aksi bertipe yang bisa dieksekusi | [sudah dibangun] |

## 5. Contoh use case: TradeFlow, pengiriman barang internasional (baru, v1.2)

Perusahaan Indonesia membeli komponen industri senilai 100.000 USDC dari pemasok luar negeri.

1. **Buyer funds escrow.** 100.000 USDC dikunci di smart contract. Di AEGIS, dana ini otomatis tercatat sebagai obligation, sehingga tidak bisa diinvestasikan ke vault.
2. **AI agents monitor milestones.** Agent membaca bukti pengiriman, data sensor, dan status dokumen.
3. **Cryptographic verification.** Bukti diverifikasi dari penerbit tepercaya (misalnya dokumen TradeTrust atau eBL), dengan ZK proof jika sesuai.
4. **Smart contract releases payment.** Pembayaran dilepas bertahap sesuai milestone yang sah.
5. **Treasury & audit updated.** Saldo, kewajiban, transaksi, dan bukti tercatat di decision ledger dan terlihat di Bank Risk Desk.

| Milestone | Payment | Syarat |
|---|---|---|
| Barang diserahkan ke pengangkut | 20.000 USDC | Bukti pengiriman valid |
| Barang sampai tujuan | 40.000 USDC | Bukti kedatangan dan kondisi pengiriman valid |
| Pemeriksaan kualitas selesai | 40.000 USDC | Bukti penerimaan disetujui |
| **Total** | **100.000 USDC** | |

Jika sensor mencatat suhu di luar batas, AEGIS menahan pembayaran yang belum dilepas dan meminta pemeriksaan tambahan.

**Batasan yang harus dijaga:**

- Blockchain dan ZK proof memverifikasi bukti digital, tetapi tidak menjamin sensor atau penerbit bukti berkata benar. Identitas dan integritas sumber bukti tetap harus diperiksa.
- Dana yang sudah dikunci untuk pemasok **tidak boleh** diputar ke DeFi demi yield tanpa persetujuan dan ketentuan escrow yang eksplisit. Yield optimization hanya memakai dana yang benar-benar bebas.
- Kill switch yang realistis adalah membekukan transaksi berikutnya dan melindungi aset yang masih dikendalikan kontrak, bukan memindahkan aset ke cold wallet dalam milidetik.
- ZK-KYC sebaiknya modul tambahan: kredensial dari penerbit tepercaya tidak otomatis menyelesaikan seluruh pemeriksaan AML.

**Implikasi desain untuk kontrak (baru, v1.2):** saat ini AegisModule hanya mengizinkan DEPOSIT dan REDEEM dengan receiver dikunci ke Safe, sehingga transfer ke pihak luar tidak mungkin. TradeFlow butuh pembayaran keluar ke pemasok. Supaya structural containment tetap kuat, pembayaran keluar harus menjadi aksi bertipe baru (misalnya `RELEASE_MILESTONE`) yang hanya boleh ke alamat pemasok yang didaftarkan owner per kontrak dagang, dengan jumlah per milestone yang sudah dikunci, dan hanya setelah bukti milestone diverifikasi. Agent tetap tidak bisa membuat penerima atau jumlah baru.

## 6. Analogi paling sederhana (baru, v1.2)

AEGIS adalah gabungan manajer keuangan, rekening bersama, dan petugas pemeriksa otomatis.

- **AI Treasury Agent** adalah manajer keuangan yang memastikan dana tersedia dan dipakai efisien.
- **AI Verification Agent** adalah petugas yang mengumpulkan dan memeriksa bukti pekerjaan.
- **ZK proof** seperti surat keterangan digital yang membuktikan suatu syarat terpenuhi tanpa membuka semua informasi.
- **Smart contract** adalah rekening bersama otomatis yang hanya melepas uang sesuai syarat yang ditetapkan.
- **Security guard** menolak transaksi tanpa izin dan bisa menghentikan tindakan tertentu saat ada risiko.
- **Bank Risk Desk** adalah pengawas yang melihat semua agent nasabah dan bisa membekukannya.

Pembeli tidak perlu percaya keputusan AI secara buta, dan pemasok tidak hanya bergantung pada janji pembeli.

## 7. Benchmarking

### Benchmark treasury agent (v1.1)

| Benchmark | Kekuatan yang sudah ada | Arah upgrade AEGIS |
|---|---|---|
| Aumo | Autonomous yield allocation, risk scoring, guardrails, decision receipts | Kewajiban kas eksplisit, otorisasi terikat kondisi, pengawasan bank |
| Giza ARMA (berhenti Februari 2026) | Continuous AI DeFi optimization, session keys | Obligation planning, evidence-based authorization |
| kpk vaults di Morpho | Rebalancing dan Exit Agent deterministik | Lapisan penjelasan AI, kewajiban, Bank Risk Desk |
| Theoriq AlphaVault | "Policy cage": AI hanya mengusulkan di dalam batas on-chain | Batas ditetapkan dan diawasi bank |
| Coinbase Agentic Wallets, Safe | Spending limits, modules, guards | Financial intelligence dan risk-bound action planning |
| PACE (paper, Agustus 2026) | Typed intent, policy and transaction binding | Risk-context dan obligation binding, terbukti di sistem yang berjalan |
| HSBC x Ant Digital (Oktober 2026) | Pembayaran AI Agent dengan tokenized deposit | Dari pembayaran ke pengelolaan treasury |

### Benchmark trade escrow dan settlement (baru, v1.2)

| Kompetitor | Kemampuan yang sudah ada | Peluang diferensiasi AEGIS |
|---|---|---|
| Tazapay | Escrow perdagangan internasional; dana dilepas setelah persetujuan pembeli atau verifikasi kewajiban | AI treasury, multi-milestone risk analysis, private evidence verification |
| Escrow.com | Perlindungan pembeli/penjual dengan biaya bertingkat (sekitar 1,9% untuk US$50.000 sampai 200.000) | Otomatisasi dokumen, workflow treasury B2B, integrasi bukti |
| TradeTrust (IMDA) | Dokumen perdagangan digital terverifikasi, termasuk eBL | Memakai dokumen terverifikasi untuk keputusan pembayaran dan pengelolaan dana |
| Surecomp RIVO | Kolaborasi importir, eksportir, bank, dan proses trade finance | Conditional execution otomatis dan financial-agent authorization |
| Circle Payments Network | Infrastruktur pembayaran lintas negara berbasis stablecoin untuk institusi | Layer aplikasi yang memutuskan kapan pembayaran boleh dilakukan |
| WaveBL | Digitalisasi dan transfer dokumen pengapalan | Menghubungkan dokumen ke treasury, risk control, dan settlement conditions |

**Opportunity gap:** banyak solusi hanya menangani satu dari tiga fungsi: **verify documents**, **manage funds**, atau **execute payment**. AEGIS menyatukan ketiganya dalam satu AI-governed workflow. Ini usulan positioning, belum terbukti tidak ada kompetitor yang menawarkan kombinasi serupa. Untuk menang secara komersial, AEGIS harus unggul terukur di waktu proses, biaya total, kualitas verifikasi, atau fleksibilitas approval. Kombinasi AI, ZK, dan blockchain saja belum cukup.

### Peserta Topic F lain di kompetisi ini (diperbarui, v1.2)

Dari 9 repositori publik Topic F yang ditemukan pada 15 Oktober 2026, yang paling kuat adalah **TreasuryPilot** (pembayaran invoice SME dengan approval EIP-712, Safe module, multi-tenant, 253 commit, tapi baru 1 transaction hash). **sucsage/agentic-wallet** punya bukti on-chain terbanyak (43 tx hash di Base Sepolia, milestone escrow untuk kontraktor UMKM). **ReceivableOS** sudah deploy di FISCO BCOS. Catatan penting: agentic-wallet sudah membangun milestone escrow, jadi TradeFlow harus menonjolkan gabungan treasury reserve, bukti terverifikasi, dan bank oversight, bukan escrow saja.

## 8. Struktur sistem

**AEGIS End-to-End Architecture**

**User Mandate + Obligations + Trade Contracts (baru, v1.2)**
Risk limits · Reserve requirements · Due payments · Milestone schedule per pemasok

**Bank Policy**
Approved vaults · Limits per nasabah · Freeze · Revoke

**Financial Engine** [sudah dibangun]
Reserve (termasuk dana escrow milestone) · Deployable balance · Allocation

**Risk Intelligence** [sudah dibangun]
Peg · Liquidity · Oracle staleness · Concentration

**Evidence Verification Agent (baru, v1.2)** [usulan]
Dokumen TradeTrust/eBL · Data sensor · Tanda tangan penerbit tepercaya · ZK proof opsional

**AI Treasury Agent** [sudah dibangun]
Understand context · Compare scenarios · Propose actions (hanya boleh lebih konservatif)

**Independent Security Verification** [sudah dibangun]
Deterministic policies · Simulation · Signed state-bound authorization (DAR, EIP-712)

**On-Chain Enforcement** [sudah dibangun]
Safe + AegisModule + PolicyRegistry. Aksi bertipe DEPOSIT/REDEEM dengan receiver dikunci ke Safe. `RELEASE_MILESTONE` ke pemasok terdaftar [usulan].

**Exit Agent** [sudah dibangun]
Redeem otomatis saat depeg, liquidity stress, atau oracle staleness

**Verifiable Decision Ledger + Bank Risk Desk** [sudah dibangun]

Perubahan dari v1.1: rencana awal memakai Zodiac Roles. Implementasi akhir memakai Safe module custom (AegisModule) karena butuh pemeriksaan berbasis kondisi (policy version, price band, reserve floor) yang tidak dimiliki role allowlist generik. Evidence utama di Base Sepolia. FISCO BCOS tetap opsi untuk kesesuaian dengan teknologi WeBank.

## 9. Dua mode produk (baru, v1.2)

Supaya nilai AEGIS tidak bergantung pada legalitas pembayaran stablecoin di setiap negara:

- **AEGIS Trade Intelligence Mode:** verifikasi dokumen, AI monitoring, treasury planning, dan conditional approval yang terhubung ke pembayaran bank atau PSP berizin.
- **AEGIS On-Chain Settlement Mode:** eksekusi lewat smart contract untuk pihak dan yurisdiksi yang secara hukum memungkinkan, setelah perizinan, AML/KYC, dan persyaratan transaksi terpenuhi.

ZK proof bisa mengurangi data yang perlu dibuka, tetapi tidak menggantikan kewajiban AML/KYC, pemantauan transaksi, atau pelaporan.

## 10. Market sizing: TAM, SAM, SOM (baru, v1.2)

Tiga angka yang tidak boleh tertukar: **trade value** (nilai barang), **payment volume** (pembayaran yang diproses platform), dan **AEGIS revenue** (pendapatan dari software dan biaya layanan). Transaksi US$100.000 lewat AEGIS adalah volume pembayaran, bukan pendapatan.

Konteks pasar: perdagangan barang dunia US$26,26 triliun pada 2025 (WTO). Perdagangan barang Indonesia US$524,77 miliar pada 2025 (ekspor US$282,91 miliar, impor US$241,86 miliar, BPS). ADB memperkirakan trade finance gap global US$2,5 triliun pada 2025. Angka ini menunjukkan kebutuhan, bukan pasar escrow yang otomatis bisa diambil AEGIS.

**Funnel Singapore-first:**

| Tahap | Jumlah | Dasar |
|---|---|---|
| Wholesale establishments | 57.715 | Data resmi Singapura 2024 |
| Punya kebutuhan relevan | 11.543 | Asumsi 20%: perdagangan lintas negara dengan conditional payments |
| Cocok secara operasional dan regulasi | 5.772 | Asumsi 50%: kesiapan digital, integrasi, metode pembayaran |
| Target pelanggan akhir tahun ke-5 | 400 | Sekitar 6,9% dari SAM |

Asumsi pendapatan per pelanggan: software US$6.000/tahun + usage fee 0,12% dari volume eligible US$500.000/tahun = **US$6.600/tahun**.

| Ukuran | Nilai/tahun | Arti |
|---|---|---|
| TAM | US$380,9 juta | 57.715 × US$6.600. Batas atas hipotetis kategori wholesale Singapura, bukan TAM global |
| SAM | US$38,1 juta | 5.772 × US$6.600. Kelompok yang secara hipotesis butuh dan bisa dilayani |
| SOM | US$2,64 juta | 400 × US$6.600. Target run-rate akhir tahun ke-5 |

SAM dan SOM adalah scenario-based estimates sampai validasi pelanggan selesai. Ini jauh lebih bisa dipertanggungjawabkan daripada menulis "TAM US$26 triliun".

## 11. Business model dan pricing (baru, v1.2)

Model: **B2B SaaS + usage-based revenue + enterprise integration**. AEGIS menyediakan software, financial intelligence, verifikasi, dan orkestrasi pembayaran. Pemindahan dana, penyimpanan aset, konversi mata uang, atau escrow yang butuh izin dilakukan lewat struktur atau mitra berizin.

| Plan | Harga hipotesis | Target |
|---|---|---|
| Starter | US$149/bulan | Eksportir kecil yang baru mencoba conditional payments |
| Growth | US$499/bulan | Importir/eksportir dengan transaksi berulang |
| Enterprise | Mulai US$1.499/bulan | Banyak pemasok, approval, dan integrasi |
| Usage fee | 0,12% dari volume eligible | Pembayaran terverifikasi yang benar-benar difasilitasi |

Harga ini rancangan, bukan hasil survei willingness-to-pay. Biaya mitra pembayaran, escrow, FX, gas, KYC, dan layanan eksternal dipisahkan dan diinformasikan transparan. Pelanggan dengan volume US$500.000/tahun membayar US$6.600 (setara 1,32% dari volume), tapi itu bukan harga settlement all-in. Jangan klaim lebih murah dari escrow tradisional sebelum ada quotation mitra.

**Business Model Canvas ringkas:**

| Elemen | Rancangan |
|---|---|
| Customer Segments | Importir, eksportir, trading companies, procurement-intensive businesses |
| Value Proposition | Faster verification, conditional settlement, treasury visibility, accountable execution |
| Channels | Direct B2B sales, logistics providers, trade platforms, payment partners |
| Customer Relationships | SaaS dashboard, onboarding, enterprise support |
| Revenue Streams | Subscriptions, usage-based fees, integrations |
| Key Activities | AI monitoring, document verification, treasury analytics, policy enforcement |
| Key Resources | AI models, smart contracts, oracle integrations, security infrastructure |
| Key Partners | Licensed payment providers, banks, eBL platforms, IoT providers, compliance vendors |
| Cost Structure | Engineering, AI/cloud, audits, legal, sales, integrations, support |

## 12. Proyeksi keuangan 5 tahun (baru, v1.2)

Asumsi base case: SaaS US$6.000/pelanggan/tahun, volume eligible US$500.000, usage fee 0,12%, gross margin 75%, churn 25%/tahun, target 400 pelanggan akhir 2031. Semua asumsi model, bukan performa yang sudah terbukti.

Angka dalam US$ ribu, kecuali jumlah pelanggan:

| Metrik | 2027 | 2028 | 2029 | 2030 | 2031 |
|---|---|---|---|---|---|
| Pelanggan akhir tahun | 16 | 50 | 120 | 240 | 400 |
| Rata-rata pelanggan aktif | 8 | 33 | 85 | 180 | 320 |
| Revenue | 52,8 | 217,8 | 561,0 | 1.188,0 | 2.112,0 |
| Gross Profit | 39,6 | 163,4 | 420,8 | 891,0 | 1.584,0 |
| Operating Expenses | 300,0 | 420,0 | 650,0 | 900,0 | 1.250,0 |
| Operating Profit / Loss | (260,4) | (256,7) | (229,3) | (9,0) | 334,0 |

Mendekati impas operasional pada 2030, potensi laba operasional sekitar US$334.000 pada 2031. Akumulasi kerugian lima tahun sekitar US$421.300; kerugian kumulatif terdalam sekitar US$755.300 pada akhir 2030. Kebutuhan pendanaan awal untuk perencanaan: **US$1 sampai 1,5 juta**, termasuk cadangan risiko dan modal kerja. Belum termasuk pajak dan capex.

**Sensitivitas tahun ke-5:**

| Skenario | Pelanggan | Annualized revenue |
|---|---|---|
| Conservative | 150 | US$750 ribu |
| Base | 400 | US$2,64 juta |
| Upside | 750 | US$7,59 juta |

**Unit economics (base case):** revenue/pelanggan US$6.600, gross profit US$4.950, CAC US$3.000, CAC payback sekitar 7,3 bulan, simple gross-profit LTV US$19.800, LTV/CAC 6,6×. Angka ini bergantung pada dua asumsi yang belum terbukti: CAC bisa serendah US$3.000, dan pelanggan bertahan serta membayar sekitar US$6.600/tahun. Kemitraan dengan logistics provider, trade platform, atau institusi pembayaran adalah kunci menekan CAC.

## 13. Go-to-market (baru, v1.2)

1. **Validate (customer discovery):** wawancara 15 sampai 30 importir, eksportir, freight forwarder, dan penyedia trade finance. Gali nilai transaksi, frekuensi pengiriman, waktu verifikasi, sengketa, sistem yang dipakai, dan kesediaan membayar.
2. **Pilot (AEGIS TradeFlow):** 3 sampai 5 perusahaan, satu jenis transaksi (misalnya impor komponen elektronik atau produk cold-chain), dengan settlement lewat jalur yang layak secara regulasi.
3. **Commercialize:** konversi pilot jadi pelanggan berbayar. Integrasi ERP, trade documents, payment providers, dan dashboard treasury.
4. **Scale:** distribusi lewat freight forwarder, platform eBL, bank, dan penyedia pembayaran. DCSA mendorong eBL menuju 2030 dan TradeTrust sudah membangun interoperabilitas dokumen, jadi AEGIS sebaiknya mengintegrasikan standar yang ada, bukan membangun ekosistem dokumen sendiri.

## 14. Risiko regulasi dan bisnis (baru, v1.2)

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Regulasi stablecoin dan pembayaran | Model settlement tertentu tidak bisa beroperasi | Fiat-first integration, mitra berizin, legal review per negara |
| Bukti IoT/oracle salah | Pembayaran dilepas berdasarkan informasi keliru | Trusted issuers, sumber bukti ganda, dispute period |
| Smart contract exploit | Aset pelanggan hilang atau terkunci | Audit, batas transaksi, emergency pause, non-custodial controls |
| Sengketa buyer dan supplier | Pembayaran tertunda, kepercayaan turun | Ketentuan kontrak, manual arbitration, aturan refund dan appeal |
| Adopsi blockchain rendah | Perusahaan enggan pakai wallet dan stablecoin | UX Web2, integrasi ERP dan payment provider, blockchain disembunyikan |
| Biaya compliance tinggi | Margin lebih rendah dari proyeksi | Partner-led compliance, tier pricing, margin per koridor |
| Pelanggan sulit diperoleh | CAC naik, ekspansi lambat | Channel partnership, fokus satu industri dulu |

## 15. Bagaimana membuktikan AEGIS lebih kuat?

**Metrik teknis (v1.1):**

| Dimensi | Metrik |
|---|---|
| Financial effectiveness | Net return after cost, liquidity shortfall, obligation coverage |
| Risk management | Drawdown, exposure concentration, risk-response time |
| Authorization security | Unauthorized execution rate, replay rejection, stale authorization rejection |
| Adversarial robustness | Hasil attack suite AgentDojo dan CrAIBench |
| Reliability | Successful authorized execution, false rejection, simulation failures |
| Explainability | Evidence completeness, decision traceability |

**KPI bisnis untuk pilot (baru, v1.2):**

| Business impact | KPI | Target pilot yang diusulkan |
|---|---|---|
| Faster verification | Waktu rata-rata validasi milestone | Turun ≥50% dari baseline manual |
| Faster payment processing | Waktu dari bukti valid sampai pembayaran disetujui | Turun ≥40% |
| Lower admin workload | Jam kerja staf per transaksi | Turun ≥30% |
| Liquidity visibility | Kewajiban tercatat dan punya rencana cadangan | ≥95% |
| Secure transactions | Transaksi tidak sah yang lolos kontrol | 0 dalam cakupan pengujian |
| Audit transparency | Transaksi dengan complete decision trail | 100% |
| Customer adoption | Pilot menjadi pelanggan berbayar | ≥30% |

Semua target adalah usulan eksperimen, bukan dampak yang sudah dicapai. Hasil pilot dibandingkan dengan baseline yang sama dan menyebut jumlah transaksi yang diuji.

## 16. Status implementasi saat ini (baru, v1.2; diperbarui 17 Okt 2026)

Sudah dibangun dan berjalan di Base Sepolia:

- **Kontrak:** AegisModule (Safe module), PolicyRegistry, dan TradeEscrow (0x009ca6F11b24fE0bAb9dE3EBb5dAb9e15f95ce76, blok 48204293). 106 Foundry test, termasuk 59 test TradeEscrow, serta fuzz dan invariant.
- **Backend:** service Python 5 proses (API, Authorizer, Exit Agent, Executor, Keeper) di server sendiri, 161 unit test dan 15 integration test. Modul TradeFlow ada di `service/aegis/tradeflow/*` dan `service/aegis/api/tradeflow.py`. LLM `claude-haiku-5-5` lewat CLIProxyAPI di VPS sudah aktif (chat agent menjawab dengan mode=llm).
- **Web app multi-tenant:** setiap pengunjung bisa membuat treasury sendiri dalam sekitar 1 menit, lalu memakai agent, approval, Bank desk, dan demo serangan. 61 web test. Live di https://porthmos.vercel.app. Halaman Orders untuk TradeFlow: sedang dikerjakan.
- **TradeFlow dibangun dan direkam (E6a sampai E6g):** order 1.000 USDC uji dengan tiga milestone (200/400/400) didanai dalam satu transaksi Safe lewat MultiSendCallOnly. Pelepasan dana melewati pipeline asli: Proof Verifier, Authorizer `/sign-release`, lalu Executor, dengan ledger reference. Penolakan terbukti on-chain: ConditionNotMet (suhu 9,40 C di luar batas 2 sampai 8 C), BadSignature (jumlah diubah setelah ditandatangani), dan Frozen (bank freeze). Milestone yang ditahan diselesaikan owner lewat waive, dan order selesai dengan 1.000 USDC terbayar ke pemasok.
- **Evidence on-chain:** E1 sampai E5 seperti sebelumnya (alokasi normal, depeg dan Exit Agent, obligation baru, BadSignature, NonceUsed, prompt injection, PriceOutOfBand, bank freeze), ditambah E6a sampai E6g. Semua direkam dengan transaction hash asli di `deployments/evidence-84532.json`.

Catatan jujur: penerbit proof di demo adalah kunci server (carrier, sensor, surveyor), jadi demo membuktikan jalur otorisasi, bukan verifikasi dokumen atau sensor yang sebenarnya.

Belum dibangun: halaman web Orders (sedang dikerjakan), ZK proof, integrasi TradeTrust/eBL dan sensor IoT nyata, dan deployment FISCO BCOS.

## 17. Rekomendasi untuk FinTechathon (baru, v1.2)

Narasi pitch: **AEGIS Treasury, TradeFlow module.**

- **Problem:** importir dan eksportir menghadapi pembayaran lintas negara yang rumit, verifikasi milestone yang lambat, serta risiko pembayaran terlambat atau salah.
- **Solution:** AI Agent yang mengelola kewajiban treasury, memverifikasi bukti pemenuhan kontrak, lalu mengotorisasi pembayaran otomatis ketika syarat terpenuhi.
- **Technical differentiation:** obligation-aware reserve yang ditegakkan on-chain, risk-context-bound authorization, structural containment, evidence verification, dan bank oversight.
- **Target customers:** mid-sized trading companies, importir, eksportir, supply-chain businesses.
- **Business model:** B2B SaaS + usage fees + integrations.

**Skenario demo yang disarankan:** satu kontrak pengiriman dengan tiga milestone. AI membaca status pengiriman, memverifikasi bukti, menentukan jumlah yang boleh dilepas, lalu membayar di testnet. Skenario kedua: pembayaran ditahan ketika data suhu tidak valid atau bukti dimanipulasi. Ini tetap relevan dengan Topic F karena AI Agent benar-benar mengelola dan mengeksekusi transaksi blockchain.

**Saran prioritas awal (sudah dijalankan, lihat bagian 16):** pertahankan treasury yang sudah berjalan sebagai inti dan bukti utama (40% nilai dari transaction hash). Tambahkan TradeFlow sebagai modul pertama dengan cakupan kecil: satu kontrak dagang, tiga milestone, bukti dari penerbit tepercaya yang ditandatangani (EIP-712), dan satu skenario penolakan. ZK proof dan sensor IoT ditampilkan sebagai roadmap, bukan klaim yang sudah dibangun.

## 18. Keputusan yang masih terbuka

1. **Nama produk (diputuskan).** Nama produk adalah **Porthmos** (bahasa Yunani: selat, jalur penyeberangan yang dijaga). Logo: opsi D. Palet warna: #4EC397 dan #F99510. Nama on-chain dan API tetap memakai Aegis (AegisModule, PolicyRegistry, `porthmos.vercel.app`), karena mengubahnya berarti mengubah bytecode, tanda tangan, alamat Safe, dan URL yang sudah live. Bagian lain dokumen ini masih memakai nama AEGIS untuk konsistensi dengan versi sebelumnya.
2. **Cakupan TradeFlow sebelum deadline (diputuskan).** Modul dibangun di testnet dan direkam sebagai E6a sampai E6g sebelum code freeze. Halaman web Orders masih dikerjakan.
3. **Target pengguna di pitch.** Importir/eksportir menengah di Singapura (dokumen feasibility) dengan UMKM lintas negara sebagai segmen lanjutan.
4. **FISCO BCOS.** Deployment tambahan untuk kesesuaian dengan teknologi WeBank, jika waktu memungkinkan.

**Core message:** From intelligent money management to intelligent, verifiable money movement. AEGIS makes autonomous finance accountable, not unrestricted.

## Referensi

- AEGIS Treasury Master Context v1.0 (Stanley): https://stanley-n-wijaya.notion.site/FinTechathon-2026-3f973555b71f80519d41feb367d69e89
- Master Context v1.1: `docs/IDEA-merged-v1.1.md`
- Aumo: https://aumo.finance/ dan https://github.com/cryptoduke01/aumo
- kpk agent-powered vaults: https://chainwire.org/2025/11/13/kpk-launches-agent-powered-vaults-on-morpho/
- Theoriq AlphaVault: https://chainwire.org/2025/12/05/theoriq-launches-alphavault-with-ai-powered-active-management/
- PACE: https://arxiv.org/abs/2608.17220
- Signing the Transaction but Not the Decision: https://arxiv.org/abs/2609.11757
- HSBC x Ant Digital: https://www.prnewswire.com/apac/news-releases/ant-digital-technologies-and-hsbc-announce-successful-ai-agent-micropayment-technical-verification-test-302903333.html
- Lobstar Wilde: https://www.kucoin.com/news/flash/ai-agent-lobstar-wilde-loses-440-000-in-solana-transfer-error
- Bankr: https://cointelegraph.com/news/bankr-disables-transactions-after-14-wallets-hacked
- Aegis Protocol V5: https://chain.link/hack-26/projects/aegis-protocol-v5
- Pemenang FinTechathon sebelumnya: https://fintechathon.g-ican.com/#/past/2025
- Sumber pasar (dari dokumen feasibility tim): WTO, BPS, Asian Development Bank, Bank Indonesia, OJK, Singapore MTI dan SingStat, IMDA TradeTrust, MAS, Tazapay, Escrow.com, Surecomp, Circle, WaveBL, DCSA
- Kompetitor Topic F: https://github.com/Nostidus4/TreasuryPilot, https://github.com/sucsage/agentic-wallet, https://github.com/Khawpuneiei/ReceivableOS
