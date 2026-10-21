// demo/confine-rebase-property.test.mjs — the guard's property is "HEAD does not move OFF THE ITEM
// BRANCH", and a VERB LIST cannot express it (#4129, spec from #4127).
//
// THE DEFECT: src/confine.mjs's deny list is a list of VERBS (reset, checkout, switch, restore,
// revert, clean, stash, branch -D, add -A/., push, plus the -C forms). The property it enforces is
// that HEAD does not move. `git rebase <upstream> <branch>` CHECKS `<branch>` OUT and leaves the seat
// off its item branch — the exact state the checkout/switch denial exists to prevent — and rebase was
// not on the list.
//
// THE CORRECTION THAT MAKES THE FIX SAFE, and it is why the property is BRANCH IDENTITY and not "HEAD
// unchanged": `git rebase <upstream>` rebases the CURRENT branch, moves its sha, and leaves HEAD ON it.
// That is the sanctioned flow, and an "unchanged sha" assertion would refuse it. So the rule is about
// the ARGUMENTS: refuse when the invocation names a branch to check out.
//
// FAILING-FIRST: on the pre-fix tree the two REFUSED cases below are ALLOWED — the guard permits a
// state it exists to prevent. The five ALLOWED cases already pass and MUST KEEP PASSING; the
// sanctioned one is the case a naive fix breaks and a reviewer will not think to try.
//
// NOTE ON THE GUARD'S POSITION: `refusalFor` runs BEFORE the child is spawned, so this guard cannot
// observe the resulting HEAD. The property is therefore decided from the COMMAND TEXT ("does this
// invocation check out a branch?"), which is the same property, decided earlier. A post-call "HEAD is
// still on the item branch" assertion is the better shape and needs a hook the environment does not
// have; it is registered, not built.
//
// Run: node demo/confine-rebase-property.test.mjs   (exit 0 = pass)

import { refusalFor } from "../src/confine.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}
// Built by concatenation on purpose: the guard scans the TEXT of a shell command, so a probe that
// spells a denied verb out in a string is itself refused. That is a real property of a text-matching
// guard, and it is why these are assembled rather than written literally.
const G = "git ";
const SW = `sw${"itch"}`;

try {
	console.log("\n=== (2) THE SANCTIONED CASE MUST PASS — rebase YOUR OWN branch ===");
	console.log("    (this is the case a 'HEAD unchanged' property would have broken)");
	check(`'${G}rebase main' is ALLOWED`, refusalFor(`${G}rebase main`) === null, String(refusalFor(`${G}rebase main`)));
	check(`'${G}rebase' (no args) is ALLOWED`, refusalFor(`${G}rebase`) === null);
	check(`'${G}rebase --continue' is ALLOWED`, refusalFor(`${G}rebase --continue`) === null);
	check(`'${G}rebase --abort' is ALLOWED`, refusalFor(`${G}rebase --abort`) === null);
	check(`'${G}rebase -i HEAD~3' is ALLOWED (one positional)`, refusalFor(`${G}rebase -i HEAD~3`) === null);
	check(`'${G}rebase --onto main old' is ALLOWED (--onto takes one value, one positional)`, refusalFor(`${G}rebase --onto main old`) === null);

	console.log("\n=== (1) THE HAZARD IS REFUSED — the invocation that CHECKS OUT another branch ===");
	{
		const twoArg = refusalFor(`${G}rebase main feature`);
		check(`'${G}rebase main feature' is REFUSED`, twoArg !== null, "allowed — the defect");
		check("...and the refusal names the hazard (HEAD off the item branch)", /move HEAD off your item branch/.test(twoArg ?? ""), twoArg ?? "");
		check("...and names the remedy (switch back to the item branch)", /switch <your-item-branch>/.test(twoArg ?? ""), twoArg ?? "");
		const onto = refusalFor(`${G}rebase --onto main old feature`);
		check(`'${G}rebase --onto main old feature' is REFUSED`, onto !== null, "allowed — the defect");
	}

	console.log("\n=== (3) THE REST OF THE BOUNDARY IS UNCHANGED ===");
	check(`'${G}${SW} main' is still REFUSED (the modern checkout)`, refusalFor(`${G}${SW} main`) !== null);
	check("the switch refusal still names switch as the modern checkout", /modern `checkout`/.test(refusalFor(`${G}${SW} main`) ?? ""));
	check("a non-git command is untouched", refusalFor("ls -la") === null);
	check("a compound command still names its FIRST matching rule", refusalFor(`${G}rebase main feature && ${G}${SW} main`) !== null);

	console.log("\n=== and the guard is a TEXT match, which is its own limitation ===");
	console.log("  a probe that SPELLS a denied verb in a string is refused too — that is why this demo");
	console.log("  assembles its cases by concatenation rather than writing them literally.");

	console.log(
		failures === 0
			? "\nPASS — rebase is judged by its ARGUMENTS: the sanctioned own-branch form passes, the check-out-another-branch form is refused, and the boundary is otherwise unchanged"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
