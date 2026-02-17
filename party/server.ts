import type { PartyKitServer } from "partykit/server";
import { onConnect } from "y-partykit";

export default {
  onConnect(connection, room) {
    return onConnect(connection, room, {
      persist: { mode: "snapshot" },
    });
  },
} satisfies PartyKitServer;
