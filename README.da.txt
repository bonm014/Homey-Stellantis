Vil du holde dig opdateret om din bil og styre den på afstand?
Denne app er til ejere af Stellantis-køretøjer (Peugeot, Citroën, DS og Opel). Du får indblik i din bil og kan sende kommandoer til den.

Indblik:
- Batteriprocent, rækkevidde, kilometertæller og vedligeholdelse (dage og kilometer).
- Batterisundhed (state of health), hvis bilen rapporterer den. Flow-handlingen "Hent batterisundhed" returnerer den som token; tokens fra handlinger kan kun bruges i Advanced Flows.
- En trigger for en ny tur, med forbrug, distance og varighed af turen.

Fjernkommandoer (Flow-handlinger):
- Starte og stoppe klimaanlægget (forhåndsklimatisering).
- Starte og stoppe opladning. Bemærk: "Stop opladning" udskyder starten til det programmerede opladningstidspunkt; bilen har ingen ægte stopkommando.
- Væk bilen og opdatér dens status. Nyttigt, fordi bilen ikke sender fremdrift under opladning. Maks. 6 pr. 20 minutter.
- Låse og låse dørene op, tude med hornet og blinke med lygterne.
- Opdatere køretøjsstatus efter behov.

Ikke alle biler understøtter alle kommandoer. Hvad der er tilgængeligt afhænger af din model og dit abonnement på forbundne tjenester. Med Flow-betingelserne "Fjerntjeneste er tilgængelig" og "Servicekode er tilgængelig" kan du tjekke dette, før en kommando sendes. Kommandoer, som din bil ikke understøtter, mislykkes med en tydelig meddelelse. Start af klimaanlægget er testet på en Peugeot; de andre kommandoer er nye og virker muligvis ikke på alle biler.

Konfiguration:
Åbn appens indstillinger på en pc/browser og følg trinnene:
1. Vælg mærke og land.
2. Log ind på din konto.
3. Gennemfør token-trinnet.
4. Bekræft med en engangskode (OTP) sendt på sms og din PIN-kode. Det er nødvendigt til fjernkommandoer. Du kan springe det over, hvis du kun vil læse data.
Du kan også starte direkte med "Request OTP" eller "Refresh OTP" fra startskærmen. OTP-tjenesten tillader 6 anmodninger pr. 24 timer, så bed ikke om flere end nødvendigt.

Støtte til andre biler:
Din bils servicekoder vises i enhedens avancerede indstillinger ("Fjerntjenester for denne bil"). Del den tekst, hvis du ønsker støtte til flere biler. Den indeholder ikke stelnummer (VIN).

Tak til:
andreadegiovine på GitHub for Home Assistant-integrationen
