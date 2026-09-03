import { db } from "./core.js";
export async function eraseAccount(id: string, actorId?: string) {
  await db.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { userId: id } });
    await tx.aiThread.deleteMany({ where: { userId: id } });
    await tx.verification.deleteMany({ where: { userId: id } });
    await tx.contact.deleteMany({
      where: { OR: [{ userId: id }, { targetId: id }] },
    });
    await tx.pushSubscription.deleteMany({ where: { userId: id } });
    await tx.notification.deleteMany({ where: { userId: id } });
    // Preserve shared messages and audit references under an anonymized account.
    await tx.user.update({
      where: { id },
      data: {
        status: "DELETED",
        email: `${id}@deleted.invalid`,
        phone: `deleted-${id}`,
        username: `deleted-${id}`,
        name: "Compte supprimé",
        bio: "",
        avatarId: null,
        googleSubject: null,
        passwordHash: "!",
        totpSecret: null,
        totpEnabled: false,
        discoverable: false,
        showPresence: false,
      },
    });
    if (actorId)
      await tx.auditLog.create({
        data: { actorId, action: "user.delete", target: id },
      });
  });
}
