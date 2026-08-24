/**
 * Whether this deployment is a deliberately non-production one.
 *
 * The test is `ALLOW_MOCK_PAYMENTS`, and reusing that variable rather than
 * inventing a `PREVIEW=yes` is the point rather than a shortcut.
 *
 * That variable already carries exactly this meaning. `MockPaymentProvider`
 * refuses to load under a production build unless it is set, so setting it is
 * a deployment saying out loud: *this environment is not taking real money*.
 * An environment that is not taking real money is not one search engines
 * should be indexing, and a second variable would be a second thing to get
 * wrong — a preview that forgot to say it was a preview would be indexed while
 * still announcing fake prices.
 *
 * It also cannot misfire in the direction that matters. Production must never
 * set this variable; if it ever does, being absent from Google is the least of
 * that deployment's problems.
 *
 * Nothing here weakens an access rule. `noindex` asks well-behaved crawlers not
 * to list the preview; it is not access control, and the documentation says so
 * in those words.
 */
export function isNonProductionEnvironment(): boolean {
  return process.env["ALLOW_MOCK_PAYMENTS"] === "yes";
}
