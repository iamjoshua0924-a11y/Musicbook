function hasPublicBook(user) {
  return Boolean(user && (user.isPrivate || user.publicBookEnabled));
}

function buildPublicBookUserQuery(userId) {
  const uid = String(userId || '').trim();
  return {
    userId: uid,
    active: { $ne: false },
    $or: [{ isPrivate: true }, { publicBookEnabled: true }]
  };
}

module.exports = { hasPublicBook, buildPublicBookUserQuery };
