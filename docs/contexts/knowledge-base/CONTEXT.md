# Knowledge Base Scheme

Terms used to describe the reusable business knowledge base scheme for large repositories.

## Language

**Business Context**:
A stable business domain or bounded area of language and ownership used to organize knowledge across code directories.
_Avoid_: Service module, code directory

**Business Capability**:
A concrete business ability within a business context that can be described, reasoned about, and linked to implementation evidence.
_Avoid_: Feature ticket, controller group

**Knowledge Source**:
A durable source of project knowledge that Yog can route into, such as a repository knowledge base.
_Avoid_: Workflow, code module

**Knowledge Source Routing**:
The first routing layer that selects the repository or durable knowledge source relevant to a user request before business knowledge routing begins inside that source.
_Avoid_: Context routing, code directory routing

**Implementation Evidence**:
Code-derived facts that support or constrain a business capability, such as routes, call graphs, tables, messages, and entry points.
_Avoid_: Design intent, architecture decision

**Architecture Decision**:
A recorded choice that explains a hard-to-reverse trade-off not obvious from code alone.
_Avoid_: Implementation note, code comment
