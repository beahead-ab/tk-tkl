# Bennys prov: BTLocoBridge på Windows

Provversion **0.85.0**, för [tk-tkl #2](https://github.com/beahead-ab/tk-tkl/issues/2).
Detta är en provguide för ändringen i PR, inte ett besked om att den redan är publicerad på main.

Automatiska prov använder syntetiska serieportar. Bluetooth, Windows-drivrutinen och den riktiga banan behöver
provas enligt guiden. Tk-TKL använder kortets **utgående Bluetooth-COM-port**, inte MAC-adress eller kanal.
Python och Bleak behövs inte.

## Förbered

1. Anteckna Windows-version, nuvarande TKL-version och om datorn är x64 eller ARM64 (Inställningar → System → Om).
2. Avsluta pågående trafik och återta alla tågvägar. Välj **LocoNet ej ansluten**. Lägg inga provorder med tåg på
   den växel eller sträcka som ska provas.
3. Ta en lokal kopia av installationens `state`-mapp och `app.env`, normalt under
   `%LOCALAPPDATA%\Träkvista TKL`. Behåll kopian tills provet är godkänt. Den innehåller privata driftuppgifter
   och ska inte bifogas GitHub-ärendet.
4. Kontrollera först att JMRI fortfarande kan ansluta till samma kort. **Avsluta därefter JMRI helt** och koppla
   från eventuella telefonappar som använder kortet. JMRI ska vara avstängt under Tk-TKL-provet.

## Installera provgrenen

Kör i vanlig PowerShell, utan administratörsrättigheter. Raden hämtar provgrenens eget installationsskript och
installerar provgrenen i den befintliga Träkvista-installationen. Inställningar och driftdata behålls.

```powershell
$env:CDA_TKL_BRANCH = 'codex/windows-bluetooth-com'
try {
  irm https://raw.githubusercontent.com/beahead-ab/tk-tkl/codex/windows-bluetooth-com/install.ps1 | iex
} finally {
  Remove-Item Env:CDA_TKL_BRANCH -ErrorAction SilentlyContinue
}
```

Kontrollera att sidfoten visar **0.85.0**. Om installationen inte startar, spara PowerShell-utskriften och de sista
30 raderna ur `%LOCALAPPDATA%\Träkvista TKL\logs\tkl.log`. Fortsätt inte med banprovet förrän rätt version startat.

## Hitta rätt COM-port

1. Para kortet i Windows Bluetooth-inställningar om det inte redan är parat.
2. Öppna **Fler Bluetooth-inställningar** (kan heta *Fler Bluetooth-alternativ*), sedan fliken **COM-portar**.
   Dialogen kan normalt också öppnas via `Win+R` → `bthprops.cpl`.
3. Leta efter kortets **utgående** port, till exempel `COM7`. Välj inte en port märkt *Inkommande*.
   Om utgående port saknas: välj **Lägg till → Utgående**, välj kortet och dess serieportstjänst.
4. Anteckna portnumret. Enhetslistan i TKL kan innehålla både Bluetooth- och USB-portar och kan inte säkert
   avgöra vilken port som hör till kortet eller om den är inkommande/utgående.

## Anslut och prova

1. Öppna **Inställningar → Banan (LocoNet)** och välj **BTLocoBridge (Bluetooth)**.
2. Klicka **Sök enheter igen**. Välj eller skriv den utgående porten, exempelvis `COM7`, i fältet
   **Utgående Bluetooth-COM-port**. Det går att skriva porten även om sökningen inte hittar den.
3. Klicka **Spara anslutningen**, sedan **Anslut till LocoNet**. På Windows ska inget kanalnummer behöva anges.
4. Kontrollera att gatewayen visar **Igång** och att statusraden visar **LocoNet ansluten**. Detta bekräftar
   anslutningen, men är inte i sig bevis på att alla banans telegram fungerar.
5. Vänta minst 15 sekunder. Kontrollera att spåravkänningen kommer från den riktiga banan. Belägg och frigör
   ett känt detekterat spår och kontrollera motsvarande indikering.
6. Lägg om en känd och fri växel åt båda håll. Kontrollera fysisk rörelse, verkligt växelläge och indikering.
   Saknad återrapport får inte godkännas som ett korrekt läge.
7. Prova en känd signal till stopp och kör under kontrollerade förhållanden, sedan tillbaka till stopp.

## Avbrott, fel och omstart

- **Avbrott:** gör kortet strömlöst när ingen order pågår. TKL ska visa att LocoNet inte svarar, och tidigare
  fältlägen ska bli okända. Slå på kortet igen: TKL ska försöka återansluta till samma COM-port. Det kan ta upp
  till 15 sekunder mellan försöken, plus den tid Windows behöver för att öppna porten.
- **Ingen orderupprepning:** en order vars kvittens uteblir får inte skickas om automatiskt. Efter återanslutning
  gör TKL sin normala uppstartsavfrågning; det är inte en upprepning av den förlorade ordern.
- **Fel port:** koppla från och spara en port som inte hör till kortet. Om porten inte kan öppnas ska senaste fel
  synas. Om en annan verklig port öppnas kan gatewayen ändå visa Igång: gå inte vidare med växelorder där.
- **Upptagen port:** med TKL frånkopplat kan JMRI få ansluta igen. Ett försök från TKL ska misslyckas tydligt när
  Windows/kortet vägrar den andra anslutningen. Avsluta JMRI, koppla från och anslut sedan TKL igen.
- **Omstart:** med fungerande anslutning och ingen trafik, logga ut och in i Windows. Kontrollera att samma port
  och det sparade läget återkommer. Kontrollera även att **Koppla från LocoNet** stoppar återanslutningsförsöken.

## Rapportera resultat

Fyll i för varje steg: **Godkänt / Underkänt / Inte provat**, och ange vad som faktiskt observerades.

| Uppgift/prov | Resultat |
|---|---|
| Datum, Windows-version och x64/ARM64 | |
| TKL-version 0.85.0 och använd provgren | |
| Kortets namn och utgående COM-port | |
| JMRI fungerar före provet och är därefter avslutat | |
| Installation och start | |
| Portlista, manuellt portval och anslutning | |
| Spåravkänning, växel och signal (ange vilka) | |
| Avbrott och återanslutning | |
| Fel/upptagen port och begripligt felmeddelande | |
| Ut-/inloggning samt frånkoppling | |

Bifoga den exakta feltexten och relevanta loggrader vid fel. Ta bort kontokoder, tokens och privata uppgifter.
Stäng inte #2 enbart för att gatewayen startar; fysisk kommunikation och återanslutning ska vara provade.

## Återgå till publicerad version

Välj först **Koppla från LocoNet**. Kör därefter den vanliga installationsraden utan provgrenen:

```powershell
Remove-Item Env:CDA_TKL_BRANCH -ErrorAction SilentlyContinue
irm https://raw.githubusercontent.com/beahead-ab/tk-tkl/main/install.ps1 | iex
```

Kontrollera versionen i panelen. Så länge main är 0.84.0 saknar den Windows-stöd för LocoNet; provgrenens sparade
COM-värde gör inte den gamla versionen ansluten. Inställningar ska inte återställas från en äldre säkerhetskopia
över senare ändringar utan att skillnaderna först granskats.
