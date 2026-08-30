# Review → refresh

Sending a review with `O` ends the review for that diff. The moment your
annotations are handed to the agent, the cockpit drops them and returns the diff
to a live view, so the agent's next commit refreshes it on its own — committed
work stops showing under "Uncommitted Changes" without you cycling the diff mode
or re-entering the agent.

Because revdiff pins each annotation to a line number, and refreshing the diff
moves those lines, comments cannot survive a refresh. "Clear on send" is the only
coherent behaviour: once a review is sent there is nothing left to re-send.
