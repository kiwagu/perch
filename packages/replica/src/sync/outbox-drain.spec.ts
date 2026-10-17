import { createOutboxDrain } from './outbox-drain'
import { describeOutboxDrain } from './outbox-drain.contract'

describeOutboxDrain('outbox drain', createOutboxDrain)
