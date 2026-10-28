# Träkvista TKL

28 oktober 2026. Träkvista i TKL: underlaget, vad som är gjort och vad som är kvar. Underlag: Bennys `Trakvista.xml`
(JMRI 5.10.0), 38 CSV-tabeller ur hans JMRI-profil och fem Jython-skript, alla i `stations/trakvista/`.

## Läget

Träkvista körs med TKL:s kärna, anläggningssimulator och panel. Alla 27 huvudtågvägar och 30 växeltågvägar läggs,
klareras och löses upp efter tågets passage, i proven och över servern med simulerad LocoNet. De rättade filerna från
[ärende #4](https://github.com/beahead-ab/tk-tkl/issues/4) används: XML-filen och samtliga 38 CSV-filer är hämtade
ur Bennys bilagor från 27 oktober. Blocklistorna stämmer med TKL:s tågvägar med ett kvarstående undantag:
`26-4v.csv` tar med S4/7, men XML:s målgräns vid A7 ligger före det blocket. Enligt bekräftat beslut den 28 oktober
gäller XML:s placering vid A7; tågvägen omfattar därför S32 och S34. Två andra tabeller beskriver inre steg i
huvudtågvägarna. Installationen på en Raspberry Pi står i [README](../README.md).

## Starta Träkvista

```sh
npm run start:trakvista          # TKL och anläggningen för Träkvista, på portarna 8910–8912
npm run import:trakvista         # återskapa Träkvistas filer ur Trakvista.xml och CSV-tabellerna
npm run verify:trakvista         # kontrollera att de genererade filerna är aktuella
node --test test/trakvista.test.mjs
```

Träkvistas driftdata ligger i `var/trakvista/`.

![Träkvista i TKL](trakvista-tkl.png)

Bilden visar panelen före XML-rättelsen den 27 oktober: A → Spår II och växeltågvägen 2/6 → 4v. I den nya källan
ligger gränsen för 4v vid A7, före växel 13. Lokspåren, Tankplatsen och
Timmerlossningen är ritade ofyllda, som i Bennys panel.

## Vad som gjordes

| Del | Fil | Vad |
|---|---|---|
| Spårplan | `scripts/import-layout.py` | JMRI:s LayoutEditor till panel.json, med korsningsväxlar. |
| Regler | `scripts/import-logixng.py` | Huvud- och växeltågvägar, NX-par, ankarpunkter, växelben och spårledningar ur LogixNG-träden. Blocklistorna i CSV-tabellerna som kontroll. |
| Profil | `scripts/make-station-profile.mjs` | Driftprofil och fältprofil med samma bibliotek som Charlottendals generator. |
| Stationsfil | `stations/trakvista/station.json` | Knapp → spår, linjerna A, B, C, lodrät riktning, lokala växlar, panelens stil. |
| Stationsval | `src/station.mjs` | `CHARLOTTENDAL_STATION`, stationens data och driftdatakatalog. |
| Kärnan | `src/topology.mjs`, `src/route-policy.mjs`, `src/exit-route.mjs`, `src/train-tracking.mjs` | Dubbel korsningsväxel och riktning på lodrätt spår. |
| Panelen | `public/app.js` m.fl. | Korsningsväxeln, ingen vändskiva, vtv-knapparna, ofyllda lokala spår, stationens namn. |
| Prov | `test/trakvista.test.mjs` | Tolv prov, bland annat alla 57 tågvägar mot simulatorn. |


## Bennys svar 17 oktober och vad som ändrades

| Fråga | Bennys svar | I TKL |
|---|---|---|
| 1. Jython-skripten | Bifogade | Sparade i `stations/trakvista/jython/` som källa. De körs inte; se nästa avsnitt. |
| 2. Växlarnas återrapport | Motorerna har inbyggda lägesgivare; alla är inte inställda i JMRI | Kärnan läser läget från två givare per växel (`feedbackSensors`), tagna efter namn: vx<nr>-t avvikande, vx<nr>-c rakt. Den rättade XML-filen har LS-givare för alla nio LocoNet-växlar, även Vx21a (LS263/LS262). |
| 3. Tabellen 23-37.csv | Kopieringsfel, rättat i ärende #4 | Blocken är nu S21a, S21b och SIII och stämmer med tågvägen. |
| 4. Växel 13 och signal 4v | Rättad XML och CSV i ärende #4; IT-växlarna är helt manuella | Källan placerar S4v/tvs4v vid A7. Den äldre specialrättelsen i `station.json` är borttagen. Enligt bekräftat beslut 28 oktober gäller XML: tågvägen omfattar S32 och S34 fram till A7. CSV:s S4/7 ligger efter målgränsen och behålls oförändrat som källunderlag. IT-växlar läggs aldrig av TKL. |
| 5. De lokala spåren | Listan stämmer | Oförändrad. |
| 6. Linjerna | Konfigurationsservern är ersatt av TrainMeet; A, B och C är med när de har en anslutning, C hade ingen | Linjerna i stationsfilen hämtar sin anslutning från TrainMeet. Kopplingen till panelen återstår. |
| 7. Bildsatserna | mod59 för relästyrda paneler, mod68 för skärm; båda finns i JMRI | Bennys panel växlar mellan mod68 (ljus) och mod59 (mörk). TKL:s panel är mörk och motsvarar hans mod59-modell, så mod59 används. |

Växelrapporten via givare gäller bara stationer vars profil anger `feedbackSensors`; Charlottendal är oförändrat. En order
till en växel som redan ligger rätt ändrar inga givare, så kärnan räknar läget som bekräftat direkt när båda givarna
visat det sedan anslutningen. Simulatorn gör som motorerna: den svarar med givarna och tiger när växeln redan ligger rätt.

## Bennys skript

| Skript | Vad det gör | Motsvarighet i TKL |
|---|---|---|
| TamSignaling.py | Klarering (TAM) med grannarna över MQTT: begär, godkänn, neka, återta, körriktning | Klareringen genom TrainMeet, som TKL redan har |
| BlockSignaling.py | Linjeblockering över MQTT: signaler, block och trafikriktning mot grannarna | Tåg på linjen och linjeläget från TrainMeet |
| RemoteControl.py | Fjärrstyrning: en fjärrnod lägger och återtar tågvägar (htv- och vtv-par) när stationen inte är lokalt betjänad | TKL:s lokal- och fjärrläge; anslutningen till ett fjärrsystem finns inte än |
| Automaten.py | Automatiskt tågmöte: vid en TAM-begäran läggs infarten till spåret i tidtabellen och begäran godkänns, annars nekas den. Tågpassering är inte skriven | TKL:s automat lägger tågvägarna; godkännandet av klareringen behöver kopplas på |
| CheckMqtt.py | Kontrollerar att MQTT-anslutningen finns | Behövs inte |

Konfigurationsserverns exempel i skripten anger A = Bilbo (BLO) och B = Charlottendal (CDA), vilket stämmer med Bennys
skärmbild och med stationsfilen.

## Kvar för Träkvista

1. **Linjerna A, B och C i panelen.** Klareringen och tågen på linjen följer i dag Charlottendals orter (Au, An …).
   Linjerna ska läsas ur stationsfilen och anslutningarna ur TrainMeet, med enkelspår, körriktning och Linjen fri.
2. **Spärr för lokalt styrda spår.** Växlarna är spärrade för TKL, men tågvägar in på lokala spår är inte spärrade i
   fjärrläge. Ingen tågväg går dit i dag.
3. **Givarna på plats.** De nio LocoNet-växlarnas givare och spårledningarnas LS-adresser behöver verifieras på anläggningen. De fyra IT-växlarna är helt manuella och saknar LocoNet-anslutning.
4. **Studio: Införandestatus och MGP-moduler.** Studio finns för Träkvista (se nedan), men Införandestatus bygger på
   Charlottendals Logix-migrering och visas inte, och modulerna kan inte läsas ur kommentarerna i Trakvista.xml.
5. **Manöver av enskild växel.** Regeln är härledd ur grafen, inte översatt från gruppen *Spärra växlar*.
6. **Automatiskt tågmöte och Friställd.** Automaten ska godkänna klareringen genom TrainMeet när infarten är lagd.

## Studio för Träkvista

Studio (Inställningar → Studio, eller `/studio.html`) läser Träkvistas egna källor: driftprofilen, panelen och
`Trakvista.xml`. Allt som räknas ur dem finns:

- **Konfigurera:** stationsplanen ritad ur Bennys panel, med 13 växlar, 25 signaler, 25 spårledningar, 11 interna block och lager för
  nummer, adresser och avvikelser; regelkorten (21, härledda ur profilen) och chatten; visning, orter och övriga delar.
- **Data:** alla mängder och de 57 tågvägarna, och **Källa**, hela Trakvista.xml post för post med JMRI:s fält och
  referenser. Originalfilen kan hämtas oförändrad.
- **Genomgång:** avvikelselistan, bland annat 9 fysiska växeladresser ej uppmätta och 21
  signalrelationer i JMRI utan tågväg.
- **Driftsättning:** utkast, aktivering, driftbindningar, mätning av objekt, lyssna och kort.

Block utan sensor är interna JMRI-objekt. De behålls för panelens geometri men räknas inte som spår utan detektering
och ger inga LocoNet-rapporter. Modellens interna id:n är inga fysiska adresser. IT-växlarna är manuella och tar varken
emot order eller återrapport på LocoNet.

Spåravkänningen läses ur LogixNG: importören har följt *Spårledningar* till ingångarna, så 22 spårledningar har en
ingång och 3 någon av flera. Reglerna som Studio härleder ur profilen kompileras tillbaka till exakt samma profil, så en
aktivering ändrar bara det som ändrats i Studio. Källregistret byggs av `npm run import:trakvista` och kontrolleras av
`npm run verify:trakvista`.

## Förrådet Tk-TKL

Tk-TKL innehåller programmet och Träkvista. Programmet utvecklas tillsammans med Charlottendal och publiceras hit, en
commit per publicering (*Publicerad från cda-tkl …*); en Pi med Träkvista uppdateras med `sudo tk-tkl-update`.
Rättelser som görs här, i programmet eller i `stations/trakvista/`, tas in där programmet utvecklas före nästa
publicering, så att de gäller båda stationerna. Publiceringen stannar om en ändring här inte finns med, så inget skrivs
över.
