Vil du holde deg oppdatert om bilen din og styre den på avstand?
Denne appen er for eiere av Stellantis-kjøretøy (Peugeot, Citroën, DS og Opel). Du får innsikt i bilen og kan sende kommandoer til den.

Innsikt:
- Batteriprosent, rekkevidde, kilometerteller og vedlikehold (dager og kilometer).
- Batterihelse (state of health), hvis bilen rapporterer den. Flow-handlingen «Hent batterihelse» returnerer den som token; tokens fra handlinger kan bare brukes i Advanced Flows.
- En trigger for en ny tur, med forbruk, distanse og varighet for turen.

Fjernkommandoer (Flow-handlinger):
- Starte og stoppe klimaanlegget (forhåndsklimatisering).
- Starte og stoppe lading. Merk: «Stopp lading» utsetter starten til den programmerte ladetiden; bilen har ingen ekte stoppkommando.
- Vekke bilen og oppdatere statusen. Nyttig, fordi bilen ikke sender fremdrift under lading. Maks 6 per 20 minutter.
- Låse og låse opp dørene, tute med hornet og blinke med lysene.
- Oppdatere kjøretøystatus ved behov.

Ikke alle biler støtter alle kommandoer. Hva som er tilgjengelig avhenger av modellen din og abonnementet ditt på tilkoblede tjenester. Med Flow-betingelsene «Fjerntjeneste er tilgjengelig» og «Tjenestekode er tilgjengelig» kan du sjekke dette før en kommando sendes. Kommandoer bilen din ikke støtter, mislykkes med en tydelig melding. Start av klimaanlegget er testet på en Peugeot; de andre kommandoene er nye og fungerer kanskje ikke på alle biler.

Konfigurasjon:
Åpne appinnstillingene på en PC/nettleser og følg trinnene:
1. Velg merke og land.
2. Logg inn på kontoen din.
3. Fullfør token-trinnet.
4. Bekreft med et engangspassord (OTP) sendt på SMS og PIN-koden din. Dette trengs for fjernkommandoer. Du kan hoppe over det hvis du bare vil lese data.
Du kan også starte direkte med «Request OTP» eller «Refresh OTP» fra startskjermen. OTP-tjenesten tillater 6 forespørsler per 24 timer, så ikke be om flere enn nødvendig.

Støtte for andre biler:
Tjenestekodene til bilen din vises i de avanserte innstillingene til enheten («Fjerntjenester for denne bilen»). Del den teksten hvis du vil ha støtte for flere biler. Den inneholder ikke understellsnummer (VIN).

Takk til:
andreadegiovine på GitHub for Home Assistant-integrasjonen
