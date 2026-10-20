/**
 * ROLL TIMING: every duration that shapes the feel of a roll, in seconds,
 * measured from the first rendered frame after Roll is pressed.
 *
 * The physics runs on its own fixed clock; these values are the cues it
 * follows (when the hands shake, when they stop, when settling gets help),
 * not a script the dice are dragged through. Tune the feel here.
 */
export const ROLL_TIMING = {
  /** Shake amplitude ramps from nothing to full strength. */
  buildUp: 0.3,
  /** The hands stop: the shared shake begins fading out. */
  shakeEnd: 3.35,
  /** How long the shake takes to fade to zero after shakeEnd. */
  shakeFade: 0.3,
  /** From here each die's last tumbles may be shaped toward its recorded face. */
  steerFrom: 1.5,
  /**
   * Look-ahead point: several ways the hands could carry on shaking from here
   * are simulated in the background, and the one whose dice need the least
   * help reaching their recorded faces is played. Playback reaches this
   * moment only after the choice is made, so nothing on screen changes.
   */
  branchAt: 2.2,
  /** From here extra resistance helps any straggler skid to a stop. */
  settleAssistFrom: 4.6,
  /** A die still not on its recorded face here gets the bounded recovery move. */
  recoverFrom: 4.85,
  /** Absolute limit for the physical phase; recovery always finishes shortly after. */
  hardStop: 5.45,
  /** Hold on the final arrangement before any emphasis appears. */
  revealHold: 0.16,
  /**
   * Halos and staggered counts; the Roll button is ready again when this ends.
   * Sized so the last count (hold + 5 × stagger + 0.34 s) and the summary
   * (hold + 6 × stagger + 0.04 s, then 0.3 s) have finished by then.
   */
  revealDuration: 0.62,
  /** Delay between successive count tiles during the reveal. */
  countStagger: 0.045,
  /** Reduced motion: dice dip out, faces change in place, dice return. */
  reducedOut: 0.18,
  reducedIn: 0.3,
} as const;

/** Time from the moment dice are confirmed at rest until the Roll button is ready. */
export const REVEAL_MS = Math.round((ROLL_TIMING.revealHold + ROLL_TIMING.revealDuration) * 1000);
