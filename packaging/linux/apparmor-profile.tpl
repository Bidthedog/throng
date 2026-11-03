# Lets throng's own binary use its browser sandbox on a machine that restricts unprivileged user namespaces (063 FR-007).
# The profile is otherwise unconfined, so it limits nothing: throng can open any folder you can.
abi <abi/4.0>,
include <tunables/global>

profile throng "/opt/throng-versions/*/throng-bin" flags=(unconfined) {
  userns,
}
