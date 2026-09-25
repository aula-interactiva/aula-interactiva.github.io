# Arquitectura de l'Aula Interactiva

Objectiu: mantenir el projecte simple, modular i fàcil de verificar. No afegir lògica duplicada a les pràctiques si pot viure en una capa comuna.

## Capes

### Portal
- `index.html`: estructura visual del portal.
- `portal.js`: navegació, visibilitat, canvi Economia/Estadística i Apunts/Pràctiques.
- `practiques.json`: catàleg i estat de les pràctiques.
- `apunts.json`: catàleg dels apunts.

### Runtime comú de pràctiques
- `tracking.js`: sessió, control d'accés, enviament, activitat i autosave.
- Les pràctiques només han d'afegir adaptadors propis quan realment tenen estat dinàmic que el guardat genèric no pot representar.

### Backend
- `apps-script/Code.gs`: backend canònic i únic del projecte. Gestiona validació d'alumnes, idempotència d'entregues, adjunts, missatges i persistència al full de càlcul.
- El full de càlcul és la font de veritat per entregues, correccions, notes, activitat i missatges.
- No s'ha de mantenir cap segon backend paral·lel al repositori.
- El codi personal només s'utilitza per iniciar sessió. Després, les lectures i escriptures privades s'autentiquen amb un token temporal de sessió; durant la migració es manté compatibilitat amb sessions antigues.
- Les operacions confirmables comparteixen una única consulta `operation-status`, identificada per tipus d'operació i ID únic. Les rutes antigues específiques es mantenen només durant la migració.

## Regles d'arquitectura

1. Una responsabilitat comuna s'implementa una sola vegada.
2. Les pràctiques no han de duplicar login, sessió, enviament ni control d'accés.
3. Les dades privades no es publiquen mai en JSON estàtic ni al repositori.
4. El backend és qui ha de decidir quines dades pot llegir cada rol.
5. Els canvis estructurals no han de modificar el comportament de les pràctiques.
6. Qualsevol funcionalitat nova important —notes, correcció, professor— ha de tenir un mòdul clar i no engrossir indiscriminadament `tracking.js`.
7. Abans de publicar: validar sintaxi i comprovar els fluxos crítics de login, guardat, restauració, entrega i accés.

## Notes i correccions

La capa de notes s'ha de mantenir separada del runtime de les pràctiques:
- Alumne: només pot consultar les seves notes.
- Professor: pot consultar totes les notes.
- `Notes`: resum per pràctica.
- `Correccions`: detall de justificacions, puntuació, valoració i comentari.

La correcció automàtica de justificacions ha d'utilitzar una rúbrica fixa i auditable. La puntuació de cada justificació pot ser 0, 0,5, 1, 1,5 o 2.
