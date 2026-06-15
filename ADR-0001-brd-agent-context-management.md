# ADR-0001: BRD Agent Context Management — Bölüm Bazlı Checkpoint Paterni

**Tarih:** 2026-06-14  
**Durum:** Kabul Edildi  
**Konu:** SDLC AI Platformu — BRD Agent

---

## Bağlam

BRD agent, kullanıcıyla 30-40 tur interview yapan, uzun süreli bir session gerektiren bir agent'tır. BRD'nin doğası gereği (executive summary → scope → requirements → assumptions → risks) birden fazla oturum veya uzun tek oturum kaçınılmazdır.

Naive yaklaşımda tüm interview geçmişi context'te birikir. 200.000 token limitine yaklaşınca ya API hata verir ya model tutarsızlaşır ya da "yeni session aç" demek zorunda kalınır — ve kullanıcı tüm analizini kaybeder.

---

## Karar

BRD agent'ında context birimi "konuşma turu" değil, **"BRD bölümü"** olacak.

Her BRD bölümü tamamlandığında:

1. O bölüm "onaylandı" olarak **dışarıya kaydedilir** (DB / state / dosya)
2. O bölümün interview turları **context'ten kaldırılır**
3. Yerine tek satır inject edilir: `"Bölüm 2: Kapsam — ONAYLANDI ✓"`
4. Sonraki bölüme geçilir

Context'te her zaman şunlar bulunur:
- Tamamlanan bölümlerin özet satırları (küçük)
- Aktif bölümün tam interview geçmişi
- Sonraki bölümün başlığı

### Partial Revision Desteği

Kullanıcı tamamlanmış bir bölümü değiştirmek isterse, sadece o bölüm yeniden açılır. Diğer bölümler context'e tam olarak yüklenmez, özet satırları yeterlidir.

### Context Doluluk Eşiği

```
%70 → Uyarı ver: "Bu bölümü tamamlayıp kaydetmeyi öneririm"
%85 → Otomatik checkpoint: aktif bölümü özetle ve kaydet
%90 → Yeni session handoff paketi oluştur
```

### Handoff Paketi İçeriği

Session değişmesi gerekirse Claude şunu üretir:

```json
{
  "tamamlanan_bolumler": [...],
  "aktif_bolum": "requirements",
  "yarim_kalan": "...",
  "sonraki_adim": "...",
  "acik_sorular": [...]
}
```

Bu paket yeni session'ın system prompt'una inject edilir.

---

## Değerlendirilen Alternatifler

**A) Sliding window (son N turu tut):** BRD'de sıralı bağımlılık var — erken bölümler sonrakileri etkiler. Salt sliding window önceki bölümlerin kararlarını kaybettirir. Reddedildi.

**B) Her turda tüm CONTEXT.md oku:** Dosya büyüdükçe her turda binlerce token harcar. Ölçeklenmez. Reddedildi.

**C) Bölüm bazlı checkpoint (seçilen):** BRD'nin kendi yapısını context yönetimi için kullan. Doğal sınırlar var, kullanıcı deneyimi bozulmuyor, partial revision mümkün.

---

## Sonuçlar

- Platform katmanı bu checkpoint mekanizmasını built-in olarak sağlamalı — BRD agent'ı bunu kendisi kurmamalı.
- Aynı pattern HLD/LLD agent ve uzun interview gerektiren diğer agent'lara da uygulanabilir.
- Token usage her turda loglanmalı (Weave'e besleme için).
- Bu karar Briefsmith için de geçerlidir — BRD bölümleri Briefsmith state'inde de aynı şekilde checkpoint olarak tutulacak.

---

## Model Seçimi

BRD agent tek bir model kullanmaz — adıma göre farklılaşır:

| Adım | Model | Gerekçe |
|---|---|---|
| Interview akışı | Sonnet | Dengeli iş, çok turlu konuşma |
| Compliance review (KVKK, BTK, fraud) | Sonnet | Kural bazlı analiz, Sonnet yeter |
| Maturity scoring | Haiku | Basit sınıflandırma, ucuz |
| Bölümler arası çelişki çözümü (opsiyonel) | Opus | Ambiguous domain, synthesis gerekince |

**Default:** Sonnet. Opus ancak açık çelişki veya yüksek ambiguity durumunda devreye girer.

---

## System Prompt Mimarisi

BRD agent system prompt'u üç katmandan oluşur ve platform tarafından birleştirilir:

```
Platform katmanı yazar  → Global kurallar, güvenlik, KVKK, araçlar
Agent katmanı yazar     → Kimlik, domain, BRD süreci, kısıtlar
Session katmanı inject  → CONTEXT.md, handoff paketi, kullanıcı/proje bilgisi
```

Agent yazanlar sadece orta katmanı bilir. Global kuralları ve session inject'ini platform halleder.

**Kapsam kısıtı:** BRD agent kod yazmaz, mimari karar vermez. Bu istekler ilgili agent'a yönlendirilir.

**Override kuralı:** Kullanıcı farklı dil veya format istese bile platform kuralları baskın gelir. Explicit override system prompt'a yazılır.

---

## Streaming Kararı

BRD agent tüm kullanıcıya dönük output'ları **streaming** ile sunacak.

**Gerekçe:** BRD bölüm yazımı ve analiz cevapları uzun output üretir. Streaming olmadan kullanıcı 20-30 saniye boş ekran bekler. Streaming ile kelimeler akar, kullanıcı okumaya başlar.

```
Streaming AÇIK:
├── Interview cevapları
├── BRD bölüm yazımı
├── Compliance review çıktısı
└── Maturity score açıklaması

Streaming KAPALI:
├── JSON output (maturity score sayısı)
├── Handoff paketi üretimi
└── Agent'tan agent'a veri aktarımı
```

**Copilot SDK notu:** Streaming desteği doğrulanmalı. Microsoft'un kendi ürünlerinde kullandığı için büyük ihtimalle mevcut, ancak expose ediliş şekli farklı olabilir.

**stop_reason kontrolü:** Stream bitince `message_stop` event'i beklenir. `max_tokens` ile bitmişse kullanıcıya "cevap kesildi, devam etmemi ister misin?" gösterilir.

---

## SDK Kısıtı — Önemli Bağlam

Vodafone Turkey platformu şirket kararıyla **GitHub Copilot SDK** kullanıyor. Bu SDK Microsoft Azure üzerinden geçtiği için aşağıdaki Anthropic API özellikleri kısıtlı veya erişilemez olabilir:

```
Cache control         → büyük ihtimalle desteklenmiyor
Model routing         → Haiku/Sonnet/Opus seçimi kısıtlı olabilir
Token usage detayı    → Microsoft formatında sarılı gelebilir
stop_reason           → farklı isimle veya eksik gelebilir
Prompt caching        → büyük ihtimalle desteklenmiyor
```

**Bu ADR'daki kararlar Anthropic API referans alınarak yazılmıştır.** Copilot SDK ile uygulanırken her özelliğin SDK'da karşılığı olup olmadığı ayrıca doğrulanmalıdır.

Platform ekibi kişisel çalışmalarında Anthropic API'ı direkt kullanarak özellikleri test edebilir, sonra Copilot SDK limitlerini kıyaslayarak belgeleyebilir.

---

## Tool Use — İnsan Onayı Kararı

BRD agent Jira'ya task açma yetkisine sahip olacak. Ancak geri alınamaz işlem olduğu için **explicit kullanıcı onayı olmadan çalışmayacak.**

**Gerekçe:** BRD süreci henüz olgunlaşmamış story'ler içerebilir. Onaysız otomatik ticket açmak Jira'da kirlilik yaratır ve geri alımı manuel efor gerektirir. BRD agent Tier 2 agent'tır — dışarıya yazıyor.

```
YANLIŞ: Her onaylanan story'de otomatik ticket aç
DOĞRU:  Kullanıcı "onayla" veya "Jira'ya yaz" deyince,
        önce "X story için ticket açıyorum, onaylıyor musunuz?"
        de, sonra aç.
```

**Tool description kuralı:** Geri alınamaz her tool'a "ne zaman çağır, ne zaman çağırma, çağırmadan önce ne sor" yazılır. Claude description'a bakarak karar verir.

**Platform geneli kural:** Dışarıya yazan (Jira, Confluence, Jenkins) tüm tool'larda insan onayı zorunludur. Sadece okuyan tool'larda (Bitbucket diff, SonarQube rapor) onay gerekmez.

---

## Batch API Kararı

BRD tamamlandığında toplu analiz işlemleri (KVKK compliance, maturity scoring, Jira format validation) **Batch API** ile yapılacak.

**Gerekçe:** 50+ story için sıralı API çağrısı yavaş ve pahalı. Batch API %50 daha ucuz, kullanıcı beklemek zorunda kalmaz.

```
BRD tamamlandı
      ↓
Batch job: tüm story'ler tek seferde gönderilir
      ↓
Kullanıcıya: "Analiz arka planda çalışıyor"
      ↓
Sonuçlar gelince toplu göster
```

**Önemli:** Batch kararı platform katmanında kod seviyesinde verilir. Claude'un (skill'in) bilmesi gerekmez. Skill sadece "bu story KVKK uyumlu mu?" sorusunu cevaplar — sorunun tek tek mi toplu mu sorulduğunu bilmez.

```
Skill'e yaz  → Claude'un ne yapacağı
Koda yaz     → API'ı nasıl çağıracağın
```

**Copilot SDK notu:** Batch API büyük ihtimalle desteklenmiyor. Bu özellik için Anthropic API direkt kullanımı değerlendirilmeli.

---

## DB Yazma Kararı — Ne Zaman, Ne Yazılır

Claude DB'ye yazmaz. Kalıcılık her zaman platform backend'inin sorumluluğudur. API veya Copilot SDK fark etmez — her çağrı sonrası state platform tarafından DB'ye yazılır.

**Ne zaman DB'ye yazılır:**

```
Her API çağrısı sonrası   → konuşma turu (mesaj + cevap)
Bölüm tamamlanınca        → onaylanan BRD içeriği (tam metin)
Context %85'e gelince      → aktif bölüm özeti + handoff paketi
Session kapanınca          → son durum snapshot'ı
Tool çağrısı sonrası       → tool sonucu (Jira ticket ID vs.)
```

**İş tipine göre DB ihtiyacı:**

```
Tek turlu, kısa agent      → DB gerekmez, memory yeterli
                              (örn. tek soruya cevap veren agent)

Çok turlu, uzun session    → DB şart
                              (BRD agent, interview agent)

Kullanıcı günler sonra     → DB şart
dönebiliyorsa              (BRD agent kesinlikle bu kategoride)

Audit log gerekiyorsa      → DB şart
                              (kurumsal platform, KVKK)
```

**Context vs DB ilişkisi:**

```
DB'ye yaz    → her şeyi, her zaman, tam metin
Context'e koy → sadece lazım olanı, sadece özet

Yarın session açılınca:
DB'den çek   → tamamlanan bölümlerin TAM METNİ
Context'e koy → sadece ÖZET SATIR
→ %15-20 dolu başla, hiçbir şey kaybolmadı
```

**Kural:** DB altyapı, summarize acil durum prosedürü. DB olmadan summarize güvenli değil — özetlenen şey kaybolur.

---

## Agentic Loop ve Guardrail Kararı

BRD agent tool use zinciri çalışırken aşağıdaki loop tasarımı uygulanır.

**Durma noktaları:**
```
end_turn        → Claude işi bitirdi, doğal son
max_turns       → platform limiti doldu (BRD agent için max: 15 tur)
hata            → tool başarısız, kullanıcı bilgilendirilir
kullanıcı onayı → "hayır" dedi, durur
guardrail       → yasak işlem tespit edildi
```

**Guardrail iki katman:**
```
System prompt guardrail  → Claude'u yönlendirir, %100 garantili değil
Kod guardrail            → kesin engel, Claude istese de çalışmaz
```

İkisi birlikte kullanılır. System prompt ile Claude eğitilir, kod ile garantilenir.

**BRD agent Tier 2'dir:**
```
Tier 1: Sadece okur (Bitbucket, SonarQube)     → guardrail minimal
Tier 2: Yazar, geri alınabilir (Jira, Confluence) → kullanıcı onayı zorunlu
Tier 3: Geri alınamaz (Jenkins deploy)          → onay + kod guardrail + audit log
```

**Kod guardrail örnekleri:**
```javascript
// Yasak tool
if (toolName === "jenkins_deploy_production") → engelle

// Limit
if (jira_ticket_count > 10) → engelle

// Onay gerektiren
if (APPROVAL_REQUIRED.includes(toolName)) → önce sor, sonra çalıştır
```

**Sonsuz döngü koruması:** Her agent için max turn platformda tanımlanır, skill'de değil.

---

## Multi-Agent Pattern Kararı

Platform orchestrator + subagent mimarisi kullanır.

**Sorumluluk ayrımı:**
```
Orchestrator  → ne yapılacağına karar verir, sıraları yönetir,
                hata durumlarını yönetir, subagent'ları koordine eder
Subagent      → sadece kendi işini bilir, diğer agent'ları tanımaz
```

Orchestrator platform ekibi tarafından yazılır. Subagent'lar domain ekipleri tarafından yazılabilir.

**Subagent'lar arası izolasyon:**
Subagent'lar birbirini tanımaz. Bağlantıyı orchestrator kurar. Bu güvenlik ve bakım kolaylığı sağlar.

**Handoff paketi kararı:**

Subagent'a ne verileceği "özet mi tam mı" değil, "işini yapması için gereken minimum" sorusuna göre belirlenir.

```
Her handoff'ta sor:
"Bu agent işini yapabilmek için tam olarak neye ihtiyaç duyuyor?"
Cevap = handoff paketi içeriği. Ne az ne fazla.
```

Örnek — HLD agent'a handoff:
```
Functional requirement'lar  → TAM METİN  (mimari karar için şart)
Scope ve kısıtlar           → TAM METİN  (sınırları bilmeli)
Executive summary           → ÖZET YETERLİ
Interview turları           → GEREKMİYOR  (DB'de dursun)
```

**Orchestrator context yönetimi:**
```
Orchestrator context'inde tut → her agent'tan gelen ÖZET + adım durumu
DB'de tut                     → her agent'ın TAM ÇIKTISI
```

Orchestrator tüm çıktıları context'te tutmaz — şişer. Tam çıktılar DB'de, orchestrator sadece koordinasyon için gereken özeti tutar.

---

## Prompt Engineering Kararları — BRD Agent

BRD agent skill'inde aşağıdaki pattern'ler uygulanır.

**CoT — Compliance ve analiz adımlarında:**
```
"KVKK değerlendirmesi yapmadan önce:
1. Kişisel veri içeren alanları tespit et
2. Her alan için risk seviyesini belirle
3. Sonra uyumluluk skorunu ver"
```
Karmaşık analiz gerektiren her adımda adım adım düşündür. Doğrudan sonuç isteme.

**Few-shot — User story formatında:**
Her story yazımında format örneği ver. 1-3 örnek yeterli, fazlası context yer.

**XML tagging — Compliance output'unda:**
```xml
<kvkk_analiz>
  <uyumluluk_skoru>78</uyumluluk_skoru>
  <eksikler>
    <eksik oncelik="high">Veri saklama süresi belirtilmemiş</eksik>
  </eksikler>
  <oneri>...</oneri>
</kvkk_analiz>
```
Yapılandırılmış output gerektiren her adımda XML tag kullan. Platform bu output'u parse eder.

**Negative instructions — Interview akışında:**
```
"Soruyu Türkçe sor.
Birden fazla soru sorma — tek soru, tek tur.
Kullanıcının cevabını değerlendirme, sadece bir sonraki soruya geç.
BRD dışı konulara girme."
```

**Her skill'de zorunlu üçlü:**
```
Role:    "Sen kıdemli bir telecom BA'sın"
Context: "Vodafone Turkey'de [proje adı] projesinde çalışıyorsun"
Task:    "Kullanıcıyla interview yaparak BRD doldur"
```
Bu üçlü olmadan Claude genel cevap verir, domain'e özgü davranmaz.

---

## Extended Thinking Kararı

BRD agent'ında extended thinking adıma göre açılır/kapatılır.

```
Interview turu         → KAPALI  (basit soru-cevap, maliyet artırma)
Bölüm tamamlandı       → AÇIK   (çelişki var mı kontrol et)
Maturity scoring       → AÇIK   (skor gerekçesi)
Compliance review      → AÇIK   (KVKK çelişkileri bul)
Story yazımı           → KAPALI (format işi)
```

**Budget token:** Compliance review için 5.000, bölüm kontrolü için 3.000. Fazlası maliyet artırır, geri dönüşü azalır.

**Düşünce bloğu:** Kullanıcıya gösterilmez. Platform audit log'una yazılır — "Claude neden bu kararı aldı?" sorusunu yanıtlamak için saklanır.

**Copilot SDK notu:** Extended thinking desteklenmiyor. Bu özellik için Anthropic API direkt kullanımı gerekir.

---

## RAG vs Tool vs Context Kararı

BRD agent'ında bilgiye erişim yöntemi kaynağa göre belirlenir:

```
Doküman / metin tabanlı     → RAG
(Confluence, geçmiş BRD'ler, PDF'ler)

Sistem / API tabanlı        → Tool
(Jira, Bitbucket, SonarQube, Jenkins)

Küçük, statik domain bilgisi → CONTEXT.md veya system prompt

Claude zaten biliyorsa      → Hiçbiri, direkt sor
```

**BRD agent için somut:**
```
"Geçmiş benzer BRD'lere bak"      → RAG
"Jira'daki açık epic'leri getir"   → Tool
"Billing domain terminolojisi"     → CONTEXT.md
"KVKK nedir"                       → Claude zaten biliyor
```

**RAG ne zaman kurulur:**
BRD agent için RAG varsayılan değil, opsiyonel. Geçmiş BRD referansı veya kurumsal standart şablon ihtiyacı doğarsa devreye girer.

**RAG kalite kuralı:** Az ve alakalı retrieval şart. 50 paragraf getirip hepsini context'e koymak gürültü yaratır, yanlış cevap ürettirir. Maksimum 3-5 alakalı parça, sıkı relevance threshold.

**Retrieval stratejisi — chunk vs page index:**

```
Chunk bazlı RAG   → uzun doküman, cevap herhangi bir yerde
Page/document index → yapılandırılmış doküman, bölüm bütünlüğü önemli
```

BRD agent geçmiş BRD referansı için **page index** kullanır. BRD bölüm bazlı yapılandırılmış olduğundan yarım chunk değil tam bölüm getirilmesi doğru sonuç üretir. Örnek: "Geçmiş CRM projelerinin scope bölümlerini getir."

Claude'un 200K context window'u sayesinde chunk'lara bölmeden tam sayfa verilebilir — klasik chunk RAG'a göre daha temiz ve bütünlüklü.

---

## MCP Kararı

BRD agent tool entegrasyonunda MCP öncelikli, yoksa tool use kullanılır.

```
Jira          → Atlassian MCP server ✓  → MCP kullan
Confluence    → Atlassian MCP server ✓  → MCP kullan
GitHub        → GitHub MCP server ✓     → MCP kullan
Bitbucket     → kontrol edilmeli
Jenkins       → MCP server yok          → tool use
RedPulse      → MCP server yok          → tool use
```

**Yetki yönetimi:** MCP server bağlamak = o sisteme erişim vermek. Her agent sadece işi için gereken server'lara bağlanır. Platform katmanı hangi agent'ın hangi MCP server'a erişebileceğini yönetir.

**Copilot SDK notu:** Microsoft MCP desteği geliştiriyor, henüz olgun değil. Takipte tut.

---

## İlgili Kararlar

- Platform'da tüm agent'lar için context doluluk monitoring built-in olacak (token usage dashboard)
- Summarize + Replace pattern'i benimsendi — summarize tek başına yeterli değil
- Session continuity için handoff paketi standardı bu ADR ile belirlendi
- Copilot SDK limit analizi yapılacak — cache, model routing, token usage karşılaştırması
