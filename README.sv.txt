Vill du hålla dig uppdaterad om din bil och styra den på distans?
Den här appen är till för ägare av Stellantis-fordon (Peugeot, Citroën, DS och Opel). Du får insyn i din bil och kan skicka kommandon till den.

Insyn:
- Batteriprocent, räckvidd, vägmätare och underhåll (dagar och kilometer).
- Batterihälsa (state of health), om bilen rapporterar den. Flow-åtgärden "Hämta batterihälsa" returnerar den som token; tokens från åtgärder kan bara användas i Advanced Flows.
- En trigger för en ny resa, med förbrukning, sträcka och varaktighet för resan.

Fjärrkommandon (Flow-åtgärder):
- Starta och stänga av klimatanläggningen (förkonditionering).
- Starta och stoppa laddning. Observera: "Stoppa laddning" skjuter upp starten till den programmerade laddningstiden; bilen har inget riktigt stoppkommando.
- Väcka bilen och uppdatera dess status. Användbart eftersom bilen inte skickar någon förloppsinformation under laddning. Högst 6 per 20 minuter.
- Låsa och låsa upp dörrarna, tuta och blinka med ljuset.
- Uppdatera fordonsstatus vid behov.

Alla bilar stöder inte alla kommandon. Vad som finns tillgängligt beror på din modell och ditt abonnemang på uppkopplade tjänster. Med Flow-villkoren "Fjärrtjänst är tillgänglig" och "Tjänstekod är tillgänglig" kan du kontrollera detta innan ett kommando skickas. Kommandon som bilen inte stöder misslyckas med ett tydligt meddelande. Att starta klimatanläggningen har testats på en Peugeot; de andra kommandona är nya och fungerar kanske inte på alla bilar.

Konfiguration:
Öppna appens inställningar på en dator/webbläsare och följ stegen:
1. Välj märke och land.
2. Logga in på ditt konto.
3. Slutför tokensteget.
4. Bekräfta med ett engångslösenord (OTP) som skickas med SMS och din PIN-kod. Det behövs för fjärrkommandon. Du kan hoppa över det om du bara vill läsa data.
Du kan också börja direkt med "Begär OTP" eller "Uppdatera OTP" från startskärmen. OTP-tjänsten tillåter 6 begäranden per 24 timmar, så begär inte fler än nödvändigt.

Stöd för andra bilar:
Din bils tjänstekoder visas i enhetens avancerade inställningar ("Fjärrtjänster för den här bilen"). Dela den texten om du vill ha stöd för fler bilar. Den innehåller inget VIN.

Tack till:
andreadegiovine på GitHub för hans Home Assistant-integration
