# Knowledge Base Scheme

Terms used to describe the reusable business knowledge base scheme for large repositories.

## Language

**Business Context**:
A stable business domain or bounded area of language and ownership used to organize knowledge across code directories.
_Avoid_: Service module, code directory

**Business Capability**:
A concrete business ability within a business context that can be described, reasoned about, and linked to implementation evidence.
_Avoid_: Feature ticket, controller group

**Feature Group**:
A top-level product navigation area represented as catalog grouping and directory structure, not as a standalone Wiki page.
_Avoid_: Business Capability, individual page operation

**Menu Feature**:
A user-visible second-level navigation destination used as the primary feature unit in the Repo Wiki.
_Avoid_: Button action, dialog, hidden page, inferred capability name

**Menu Scope**:
The set of menu nodes a user provides for one Wiki generation run, defining what that run should document without claiming to represent the complete product.
_Avoid_: Full product menu, role permission set

**Subfeature**:
A deeper navigation item or bounded operation owned by a menu feature and documented inside that feature rather than as a primary Repo Wiki function.
_Avoid_: Menu Feature, Feature Group

**Feature Evidence Bundle**:
A bounded set of requirement, recorded workflow, specification, and implementation evidence supplied together to update one or more menu features and link them to durable business capabilities when known.
_Avoid_: Feature ticket, Wiki page

**Expected Behavior**:
A business rule or outcome stated by a requirement, specification, or explicit human decision, independent of whether the current implementation satisfies it.
_Avoid_: Implementation fact, observed result

**Observed Behavior**:
An outcome actually seen for a specific role, environment, version, and time during a recorded or verified workflow.
_Avoid_: Expected behavior, universal product behavior

**Uncovered Branch**:
A known path or outcome that available workflow evidence did not exercise.
_Avoid_: Failed behavior, unsupported feature

**Product Page**:
A stable user-facing workspace with a coherent purpose, entry, and set of related operations.
_Avoid_: Dialog, UI component, individual button

**User Scenario**:
A role-oriented user goal and observed interaction sequence projected from a recorded workflow and associated with one or more menu features inside a feature group.
_Avoid_: Expected workflow, individual click, API call, Business Flow

**Business Flow**:
An end-to-end business process that connects user scenarios across feature groups through their sequence, state transitions, handoffs, and outcome.
_Avoid_: User Scenario, repeated page-click instructions

**Page Interaction**:
An operation or transient interaction inside a product page that does not own an independent user-facing workspace.
_Avoid_: Product Page, Business Capability

**Requirement Trace**:
A secondary traceability view that links a requirement work item to the durable capabilities, scenarios, acceptance criteria, and evidence it affected.
_Avoid_: Business Capability, primary Wiki navigation

**Knowledge Source**:
A durable source of project knowledge that Yog can route into, such as a repository knowledge base.
_Avoid_: Workflow, code module

**Knowledge Source Routing**:
The first routing layer that selects the repository or durable knowledge source relevant to a user request before business knowledge routing begins inside that source.
_Avoid_: Context routing, code directory routing

**Implementation Evidence**:
Code-derived facts that support or constrain a business capability, such as routes, call graphs, tables, messages, and entry points.
_Avoid_: Design intent, architecture decision

**Partial Evidence**:
Evidence that supports a bounded conclusion but lacks some observation, linkage, or context required for a complete claim.
_Avoid_: Invalid evidence, failed workflow, confirmed behavior

**Architecture Decision**:
A recorded choice that explains a hard-to-reverse trade-off not obvious from code alone.
_Avoid_: Implementation note, code comment
