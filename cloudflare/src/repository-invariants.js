import { D1Repository } from './repository.js';

const PATCHED = Symbol.for('taskbay.d1.requester-invariants');
const REQUESTER_TRANSITIONS = new Set(['completed', 'disputed']);

export function assertBoundRequester(task, claimedRequesterId) {
  if (!task?.requesterAgentId) throw fail('task_requester_unbound', 409, 'This task has no bound requester.');
  if (!claimedRequesterId) throw fail('requester_agent_required', 401, 'Requester identity is required.');
  if (task.requesterAgentId !== claimedRequesterId) throw fail('requester_mismatch', 403, 'Requester identity does not own this task.');
}

export function requesterOwnsTransition(task, to) {
  return REQUESTER_TRANSITIONS.has(to) || (to === 'working' && task?.status === 'delivered');
}

export function installD1RequesterInvariantGuards() {
  const proto = D1Repository.prototype;
  if (proto[PATCHED]) return;
  Object.defineProperty(proto, PATCHED, { value: true });

  const createTask = proto.createTask;
  proto.createTask = async function guardedCreateTask(input, ctx) {
    if (!input?.requesterAgentId) throw fail('requester_agent_required', 401, 'A requester agent identity is required to publish work.');
    return createTask.call(this, input, ctx);
  };

  const selectProvider = proto.selectProvider;
  proto.selectProvider = async function guardedSelectProvider(taskId, requesterAgentId, providerAgentId, ctx) {
    assertBoundRequester(await this.mustTask(taskId), requesterAgentId);
    return selectProvider.call(this, taskId, requesterAgentId, providerAgentId, ctx);
  };

  const transition = proto.transition;
  proto.transition = async function guardedTransition(taskId, to, actorId, input, ctx) {
    const task = await this.mustTask(taskId);
    if (requesterOwnsTransition(task, to)) assertBoundRequester(task, actorId);
    if (to === 'cancelled' && !task.requesterAgentId && actorId !== task.providerAgentId) {
      throw fail('task_requester_unbound', 409, 'A legacy unbound task can only be cancelled by its assigned provider.');
    }
    return transition.call(this, taskId, to, actorId, input, ctx);
  };

  const createPayment = proto.createPayment;
  proto.createPayment = async function guardedCreatePayment(taskId, requesterAgentId, input, ctx) {
    assertBoundRequester(await this.mustTask(taskId), requesterAgentId);
    return createPayment.call(this, taskId, requesterAgentId, input, ctx);
  };
}

function fail(code, status, message) {
  return Object.assign(new Error(message), { code, status });
}

installD1RequesterInvariantGuards();
