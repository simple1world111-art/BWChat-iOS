export interface ConversationAccountTicket {
  ownerId: string;
  generation: number;
}

/** Invalidates late list operations when the authenticated account changes, including A→B→A. */
export class ConversationAccountScope {
  private ownerId: string;
  private generation = 0;

  constructor(ownerId: string) {
    this.ownerId = ownerId;
  }

  updateOwner(ownerId: string): boolean {
    if (ownerId === this.ownerId) return false;
    this.ownerId = ownerId;
    this.generation += 1;
    return true;
  }

  capture(): ConversationAccountTicket {
    return { ownerId: this.ownerId, generation: this.generation };
  }

  isCurrent(ticket: ConversationAccountTicket): boolean {
    return ticket.ownerId === this.ownerId && ticket.generation === this.generation;
  }
}
