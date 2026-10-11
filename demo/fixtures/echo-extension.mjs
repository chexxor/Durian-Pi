// A minimal, real extension — the shape an extension must have, and the fixture
// demo/extensions.test.mjs loads.
//
// It adds one prompt section. That is deliberately the smallest thing that still
// proves the whole path: config → load → install → the model sees it. A section
// renders into the `pi.system` entry's `sections` map, which is where the test
// reads it back from.
import { defineExtension, section } from "@earendil-works/pi-durable";

export default defineExtension({
	name: "echo",
	sections: [section("echo-note", () => "ECHO-EXTENSION-REACHED-THE-MODEL")],
});
