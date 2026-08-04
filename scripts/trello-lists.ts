/**
 * Print every open Trello board on the token's account with its list ids, so
 * TRELLO_LIST_ID / TRELLO_FEATURE_LIST_ID can be filled in.
 *
 * Usage:
 *   npm run trello:lists
 *
 * Required env (.env.local): TRELLO_API_KEY, TRELLO_TOKEN.
 * Get them at https://trello.com/power-ups/admin then
 * https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&name=DreamMe%20Admin%20Dash&key=YOUR_KEY
 */
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import { listBoards, listLists } from "../src/lib/vendors/trello";

async function main() {
  if (!process.env.TRELLO_API_KEY || !process.env.TRELLO_TOKEN) {
    console.error(
      "\n  TRELLO_API_KEY / TRELLO_TOKEN not set in .env.local — see the header of this file.\n",
    );
    process.exit(1);
  }

  const boards = await listBoards();
  if (boards.length === 0) {
    console.error("\n  No open boards on this account.\n");
    return;
  }

  console.log("");
  for (const board of boards) {
    console.log(`  ${board.name}  ${board.id}`);
    const lists = await listLists(board.id);
    lists.forEach((l, i) => {
      const branch = i === lists.length - 1 ? "└" : "├";
      console.log(`    ${branch} ${l.name.padEnd(24)} ${l.id}`);
    });
    console.log("");
  }
  console.log(
    "  Copy the id of the list tickets should land in into TRELLO_LIST_ID,\n" +
      "  and the Feature Requests list into TRELLO_FEATURE_LIST_ID.\n",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
