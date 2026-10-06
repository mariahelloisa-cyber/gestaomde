export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_generation_jobs: {
        Row: {
          art_request_id: string
          cancelado_por: string | null
          concluido_em: string | null
          criado_em: string
          custo_estimado_usd: number | null
          erro: string | null
          id: string
          iniciado_em: string | null
          instrucoes_ajuste: string | null
          insumos: Json
          lease_ate: string | null
          max_tentativas: number
          modelo: string | null
          openai_response_id: string | null
          origem: string
          parametros: Json
          prompt_final: string | null
          prompt_versao: string | null
          qtd_variacoes: number
          solicitado_por: string | null
          status: string
          tentativas: number
          uso: Json | null
        }
        Insert: {
          art_request_id: string
          cancelado_por?: string | null
          concluido_em?: string | null
          criado_em?: string
          custo_estimado_usd?: number | null
          erro?: string | null
          id?: string
          iniciado_em?: string | null
          instrucoes_ajuste?: string | null
          insumos?: Json
          lease_ate?: string | null
          max_tentativas?: number
          modelo?: string | null
          openai_response_id?: string | null
          origem?: string
          parametros?: Json
          prompt_final?: string | null
          prompt_versao?: string | null
          qtd_variacoes?: number
          solicitado_por?: string | null
          status?: string
          tentativas?: number
          uso?: Json | null
        }
        Update: {
          art_request_id?: string
          cancelado_por?: string | null
          concluido_em?: string | null
          criado_em?: string
          custo_estimado_usd?: number | null
          erro?: string | null
          id?: string
          iniciado_em?: string | null
          instrucoes_ajuste?: string | null
          insumos?: Json
          lease_ate?: string | null
          max_tentativas?: number
          modelo?: string | null
          openai_response_id?: string | null
          origem?: string
          parametros?: Json
          prompt_final?: string | null
          prompt_versao?: string | null
          qtd_variacoes?: number
          solicitado_por?: string | null
          status?: string
          tentativas?: number
          uso?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_jobs_art_request_id_fkey"
            columns: ["art_request_id"]
            isOneToOne: false
            referencedRelation: "art_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_jobs_cancelado_por_fkey"
            columns: ["cancelado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_jobs_solicitado_por_fkey"
            columns: ["solicitado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generation_reviews: {
        Row: {
          art_request_id: string
          comentario: string | null
          criado_em: string
          decisao: string
          generation_ids: string[]
          id: string
          job_id: string
          revisor_id: string | null
        }
        Insert: {
          art_request_id: string
          comentario?: string | null
          criado_em?: string
          decisao: string
          generation_ids?: string[]
          id?: string
          job_id: string
          revisor_id?: string | null
        }
        Update: {
          art_request_id?: string
          comentario?: string | null
          criado_em?: string
          decisao?: string
          generation_ids?: string[]
          id?: string
          job_id?: string
          revisor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_generation_reviews_art_request_id_fkey"
            columns: ["art_request_id"]
            isOneToOne: false
            referencedRelation: "art_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ai_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generation_reviews_revisor_id_fkey"
            columns: ["revisor_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generations: {
        Row: {
          altura: number | null
          art_request_id: string
          criado_em: string
          id: string
          job_id: string
          largura: number | null
          mime_type: string
          path: string
          path_aprovado: string | null
          revised_prompt: string | null
          slide_index: number
          status: string
          status_alterado_em: string | null
          status_alterado_por: string | null
          variacao: number
        }
        Insert: {
          altura?: number | null
          art_request_id: string
          criado_em?: string
          id?: string
          job_id: string
          largura?: number | null
          mime_type?: string
          path: string
          path_aprovado?: string | null
          revised_prompt?: string | null
          slide_index?: number
          status?: string
          status_alterado_em?: string | null
          status_alterado_por?: string | null
          variacao?: number
        }
        Update: {
          altura?: number | null
          art_request_id?: string
          criado_em?: string
          id?: string
          job_id?: string
          largura?: number | null
          mime_type?: string
          path?: string
          path_aprovado?: string | null
          revised_prompt?: string | null
          slide_index?: number
          status?: string
          status_alterado_em?: string | null
          status_alterado_por?: string | null
          variacao?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_generations_art_request_id_fkey"
            columns: ["art_request_id"]
            isOneToOne: false
            referencedRelation: "art_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generations_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "ai_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_generations_status_alterado_por_fkey"
            columns: ["status_alterado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      aniversariante_visualizacoes: {
        Row: {
          aniversariante_id: string
          usuario_id: string
          visto_em: string
        }
        Insert: {
          aniversariante_id: string
          usuario_id?: string
          visto_em?: string
        }
        Update: {
          aniversariante_id?: string
          usuario_id?: string
          visto_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "aniversariante_visualizacoes_aniversariante_id_fkey"
            columns: ["aniversariante_id"]
            isOneToOne: false
            referencedRelation: "aniversariantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aniversariante_visualizacoes_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      aniversariantes: {
        Row: {
          atualizado_em: string
          criado_em: string
          criado_por: string | null
          data_comemoracao: string
          id: string
          imagens: Json
          mensagem: string
          nome: string
          publicado_em: string | null
          publicado_por: string | null
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          data_comemoracao: string
          id?: string
          imagens: Json
          mensagem: string
          nome: string
          publicado_em?: string | null
          publicado_por?: string | null
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          data_comemoracao?: string
          id?: string
          imagens?: Json
          mensagem?: string
          nome?: string
          publicado_em?: string | null
          publicado_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aniversariantes_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aniversariantes_publicado_por_fkey"
            columns: ["publicado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      art_references: {
        Row: {
          altura: number | null
          ativo: boolean
          atualizado_em: string
          categoria: string | null
          cliente_id: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          id: string
          largura: number | null
          metadados: Json
          mime_type: string
          path: string
          projeto_id: string | null
          tags: string[]
          tipos_arte: string[]
          titulo: string
        }
        Insert: {
          altura?: number | null
          ativo?: boolean
          atualizado_em?: string
          categoria?: string | null
          cliente_id?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          largura?: number | null
          metadados?: Json
          mime_type?: string
          path: string
          projeto_id?: string | null
          tags?: string[]
          tipos_arte?: string[]
          titulo: string
        }
        Update: {
          altura?: number | null
          ativo?: boolean
          atualizado_em?: string
          categoria?: string | null
          cliente_id?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          largura?: number | null
          metadados?: Json
          mime_type?: string
          path?: string
          projeto_id?: string | null
          tags?: string[]
          tipos_arte?: string[]
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "art_references_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "art_references_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "art_references_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      art_request_files: {
        Row: {
          altura: number | null
          art_request_id: string
          categoria: string
          confirmado: boolean
          confirmado_em: string | null
          criado_em: string
          enviado_por: string | null
          id: string
          largura: number | null
          mime_type: string
          nome_arquivo: string
          path: string
          tamanho_bytes: number | null
        }
        Insert: {
          altura?: number | null
          art_request_id: string
          categoria: string
          confirmado?: boolean
          confirmado_em?: string | null
          criado_em?: string
          enviado_por?: string | null
          id?: string
          largura?: number | null
          mime_type: string
          nome_arquivo: string
          path: string
          tamanho_bytes?: number | null
        }
        Update: {
          altura?: number | null
          art_request_id?: string
          categoria?: string
          confirmado?: boolean
          confirmado_em?: string | null
          criado_em?: string
          enviado_por?: string | null
          id?: string
          largura?: number | null
          mime_type?: string
          nome_arquivo?: string
          path?: string
          tamanho_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "art_request_files_art_request_id_fkey"
            columns: ["art_request_id"]
            isOneToOne: false
            referencedRelation: "art_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      art_requests: {
        Row: {
          altura_px: number
          aprovado_em: string | null
          aprovado_por: string | null
          atualizado_em: string
          briefing: string | null
          campos: Json
          cliente_id: string | null
          criado_em: string
          data_comemorativa: string | null
          demanda_id: string | null
          id: string
          job_aprovado_id: string | null
          largura_px: number
          max_geracoes: number
          medida_impressao: Json | null
          projeto_id: string | null
          qtd_slides: number
          responsavel_id: string | null
          solicitante_user_id: string | null
          status: string
          status_alterado_em: string | null
          status_alterado_por: string | null
          tipo: string
        }
        Insert: {
          altura_px: number
          aprovado_em?: string | null
          aprovado_por?: string | null
          atualizado_em?: string
          briefing?: string | null
          campos?: Json
          cliente_id?: string | null
          criado_em?: string
          data_comemorativa?: string | null
          demanda_id?: string | null
          id?: string
          job_aprovado_id?: string | null
          largura_px: number
          max_geracoes?: number
          medida_impressao?: Json | null
          projeto_id?: string | null
          qtd_slides?: number
          responsavel_id?: string | null
          solicitante_user_id?: string | null
          status?: string
          status_alterado_em?: string | null
          status_alterado_por?: string | null
          tipo: string
        }
        Update: {
          altura_px?: number
          aprovado_em?: string | null
          aprovado_por?: string | null
          atualizado_em?: string
          briefing?: string | null
          campos?: Json
          cliente_id?: string | null
          criado_em?: string
          data_comemorativa?: string | null
          demanda_id?: string | null
          id?: string
          job_aprovado_id?: string | null
          largura_px?: number
          max_geracoes?: number
          medida_impressao?: Json | null
          projeto_id?: string | null
          qtd_slides?: number
          responsavel_id?: string | null
          solicitante_user_id?: string | null
          status?: string
          status_alterado_em?: string | null
          status_alterado_por?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "art_requests_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "art_requests_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "art_requests_demanda_id_fkey"
            columns: ["demanda_id"]
            isOneToOne: true
            referencedRelation: "demandas_externas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "art_requests_job_aprovado_fk"
            columns: ["job_aprovado_id"]
            isOneToOne: false
            referencedRelation: "ai_generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "art_requests_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "art_requests_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "art_requests_status_alterado_por_fkey"
            columns: ["status_alterado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_assets: {
        Row: {
          ativo: boolean
          atualizado_em: string
          cliente_id: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          id: string
          mime_type: string | null
          nome: string
          path: string | null
          projeto_id: string | null
          tags: string[]
          tipo: string
          valor: Json
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          cliente_id?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          mime_type?: string | null
          nome: string
          path?: string | null
          projeto_id?: string | null
          tags?: string[]
          tipo: string
          valor?: Json
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          cliente_id?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          mime_type?: string | null
          nome?: string
          path?: string | null
          projeto_id?: string | null
          tags?: string[]
          tipo?: string
          valor?: Json
        }
        Relationships: [
          {
            foreignKeyName: "brand_assets_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_assets_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_assets_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          contrato_url: string | null
          criado_em: string
          criado_por: string | null
          documento: string | null
          email: string | null
          endereco: string | null
          id: string
          logo_url: string | null
          nome_empresa: string
          plano: Database["public"]["Enums"]["plano_cliente"]
          status: string
        }
        Insert: {
          contrato_url?: string | null
          criado_em?: string
          criado_por?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          logo_url?: string | null
          nome_empresa: string
          plano?: Database["public"]["Enums"]["plano_cliente"]
          status?: string
        }
        Update: {
          contrato_url?: string | null
          criado_em?: string
          criado_por?: string | null
          documento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          logo_url?: string | null
          nome_empresa?: string
          plano?: Database["public"]["Enums"]["plano_cliente"]
          status?: string
        }
        Relationships: []
      }
      comentarios_tarefa: {
        Row: {
          conteudo: string
          criado_em: string
          id: string
          tarefa_id: string
          usuario_id: string
        }
        Insert: {
          conteudo: string
          criado_em?: string
          id?: string
          tarefa_id: string
          usuario_id: string
        }
        Update: {
          conteudo?: string
          criado_em?: string
          id?: string
          tarefa_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comentarios_tarefa_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comentarios_tarefa_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      compartilhamentos: {
        Row: {
          acessos: number
          aniversariante_id: string | null
          cliente_id: string | null
          criado_em: string
          criado_por: string | null
          expira_em: string | null
          id: string
          membro_id: string | null
          revogado_em: string | null
          status: string | null
          tarefa_id: string | null
          tipo: string
          token: string
          ultimo_acesso_em: string | null
        }
        Insert: {
          acessos?: number
          aniversariante_id?: string | null
          cliente_id?: string | null
          criado_em?: string
          criado_por?: string | null
          expira_em?: string | null
          id?: string
          membro_id?: string | null
          revogado_em?: string | null
          status?: string | null
          tarefa_id?: string | null
          tipo: string
          token?: string
          ultimo_acesso_em?: string | null
        }
        Update: {
          acessos?: number
          aniversariante_id?: string | null
          cliente_id?: string | null
          criado_em?: string
          criado_por?: string | null
          expira_em?: string | null
          id?: string
          membro_id?: string | null
          revogado_em?: string | null
          status?: string | null
          tarefa_id?: string | null
          tipo?: string
          token?: string
          ultimo_acesso_em?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compartilhamentos_aniversariante_id_fkey"
            columns: ["aniversariante_id"]
            isOneToOne: false
            referencedRelation: "aniversariantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compartilhamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compartilhamentos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compartilhamentos_membro_id_fkey"
            columns: ["membro_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compartilhamentos_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes_planos: {
        Row: {
          atualizado_em: string
          criado_em: string
          id: string
          nome_plano: string
          servicos_inclusos: Json
          valor_mensal: number
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          id?: string
          nome_plano: string
          servicos_inclusos?: Json
          valor_mensal?: number
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          id?: string
          nome_plano?: string
          servicos_inclusos?: Json
          valor_mensal?: number
        }
        Relationships: []
      }
      configuracoes_sistema: {
        Row: {
          atualizado_em: string
          atualizado_por: string | null
          chave: string
          descricao: string | null
          valor: string | null
        }
        Insert: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave: string
          descricao?: string | null
          valor?: string | null
        }
        Update: {
          atualizado_em?: string
          atualizado_por?: string | null
          chave?: string
          descricao?: string | null
          valor?: string | null
        }
        Relationships: []
      }
      convites: {
        Row: {
          aceito_em: string | null
          cargo: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id: string | null
          convidado_por: string | null
          criado_em: string
          email: string
          id: string
          status: string
        }
        Insert: {
          aceito_em?: string | null
          cargo?: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id?: string | null
          convidado_por?: string | null
          criado_em?: string
          email: string
          id?: string
          status?: string
        }
        Update: {
          aceito_em?: string | null
          cargo?: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id?: string | null
          convidado_por?: string | null
          criado_em?: string
          email?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "convites_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      demandas_externas: {
        Row: {
          anexos: Json
          atualizado_em: string
          audio: Json | null
          criado_em: string
          descricao: string
          id: string
          justificativa_recusa: string | null
          prazo_sugerido: string | null
          responsavel_id: string | null
          setor: string | null
          solicitante_email: string | null
          solicitante_nome: string
          solicitante_user_id: string | null
          status: Database["public"]["Enums"]["status_demanda"]
          tarefa_id: string | null
          tipo: string
          video: Json | null
        }
        Insert: {
          anexos?: Json
          atualizado_em?: string
          audio?: Json | null
          criado_em?: string
          descricao: string
          id?: string
          justificativa_recusa?: string | null
          prazo_sugerido?: string | null
          responsavel_id?: string | null
          setor?: string | null
          solicitante_email?: string | null
          solicitante_nome: string
          solicitante_user_id?: string | null
          status?: Database["public"]["Enums"]["status_demanda"]
          tarefa_id?: string | null
          tipo?: string
          video?: Json | null
        }
        Update: {
          anexos?: Json
          atualizado_em?: string
          audio?: Json | null
          criado_em?: string
          descricao?: string
          id?: string
          justificativa_recusa?: string | null
          prazo_sugerido?: string | null
          responsavel_id?: string | null
          setor?: string | null
          solicitante_email?: string | null
          solicitante_nome?: string
          solicitante_user_id?: string | null
          status?: Database["public"]["Enums"]["status_demanda"]
          tarefa_id?: string | null
          tipo?: string
          video?: Json | null
        }
        Relationships: []
      }
      demandas_externas_usuarios: {
        Row: {
          criado_em: string
          email: string
          id: string
          nome: string
        }
        Insert: {
          criado_em?: string
          email: string
          id: string
          nome: string
        }
        Update: {
          criado_em?: string
          email?: string
          id?: string
          nome?: string
        }
        Relationships: []
      }
      email_logs: {
        Row: {
          assunto: string
          criado_em: string
          destinatario: string | null
          id: string
          mensagem: string
          resposta: string | null
          status: string
          tarefa_id: string | null
          tipo: string
          usuario_id: string | null
        }
        Insert: {
          assunto: string
          criado_em?: string
          destinatario?: string | null
          id?: string
          mensagem: string
          resposta?: string | null
          status: string
          tarefa_id?: string | null
          tipo: string
          usuario_id?: string | null
        }
        Update: {
          assunto?: string
          criado_em?: string
          destinatario?: string | null
          id?: string
          mensagem?: string
          resposta?: string | null
          status?: string
          tarefa_id?: string | null
          tipo?: string
          usuario_id?: string | null
        }
        Relationships: []
      }
      financeiro_transacoes: {
        Row: {
          cliente_id: string | null
          criado_em: string
          criado_por: string | null
          data_pagamento: string
          descricao: string
          id: string
          tipo: string
          valor: number
        }
        Insert: {
          cliente_id?: string | null
          criado_em?: string
          criado_por?: string | null
          data_pagamento?: string
          descricao: string
          id?: string
          tipo: string
          valor?: number
        }
        Update: {
          cliente_id?: string | null
          criado_em?: string
          criado_por?: string | null
          data_pagamento?: string
          descricao?: string
          id?: string
          tipo?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_transacoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      ideias: {
        Row: {
          avaliado_em: string | null
          avaliado_por: string | null
          criado_em: string
          criado_por: string
          descricao: string | null
          id: string
          pontos: number | null
          status: string
          titulo: string
        }
        Insert: {
          avaliado_em?: string | null
          avaliado_por?: string | null
          criado_em?: string
          criado_por: string
          descricao?: string | null
          id?: string
          pontos?: number | null
          status?: string
          titulo: string
        }
        Update: {
          avaliado_em?: string | null
          avaliado_por?: string | null
          criado_em?: string
          criado_por?: string
          descricao?: string | null
          id?: string
          pontos?: number | null
          status?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "ideias_avaliado_por_fkey"
            columns: ["avaliado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ideias_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      murais: {
        Row: {
          cor: string
          criado_em: string
          descricao: string | null
          id: string
          nome: string
          posicao: number
          usuario_id: string
        }
        Insert: {
          cor: string
          criado_em?: string
          descricao?: string | null
          id?: string
          nome: string
          posicao?: number
          usuario_id?: string
        }
        Update: {
          cor?: string
          criado_em?: string
          descricao?: string | null
          id?: string
          nome?: string
          posicao?: number
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "murais_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      mural_itens: {
        Row: {
          criado_em: string
          id: string
          mural_id: string
          posicao: number
          quadro_id: string
          tarefa_id: string
          usuario_id: string
        }
        Insert: {
          criado_em?: string
          id?: string
          mural_id?: string
          posicao?: number
          quadro_id: string
          tarefa_id: string
          usuario_id?: string
        }
        Update: {
          criado_em?: string
          id?: string
          mural_id?: string
          posicao?: number
          quadro_id?: string
          tarefa_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mural_itens_quadro_fkey"
            columns: ["quadro_id", "mural_id"]
            isOneToOne: false
            referencedRelation: "mural_quadros"
            referencedColumns: ["id", "mural_id"]
          },
          {
            foreignKeyName: "mural_itens_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mural_itens_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      mural_quadros: {
        Row: {
          cor: string
          criado_em: string
          id: string
          mural_id: string
          nome: string
          posicao: number
          usuario_id: string
        }
        Insert: {
          cor: string
          criado_em?: string
          id?: string
          mural_id: string
          nome: string
          posicao?: number
          usuario_id?: string
        }
        Update: {
          cor?: string
          criado_em?: string
          id?: string
          mural_id?: string
          nome?: string
          posicao?: number
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mural_quadros_mural_id_fkey"
            columns: ["mural_id"]
            isOneToOne: false
            referencedRelation: "murais"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mural_quadros_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      organograma_nos: {
        Row: {
          auditoria_aviso_expirado_em: string | null
          auditoria_aviso_lembrete_em: string | null
          auditoria_marcada_em: string | null
          criado_em: string
          criado_por: string | null
          id: string
          link: string | null
          nome: string
          parent_id: string | null
        }
        Insert: {
          auditoria_aviso_expirado_em?: string | null
          auditoria_aviso_lembrete_em?: string | null
          auditoria_marcada_em?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          link?: string | null
          nome: string
          parent_id?: string | null
        }
        Update: {
          auditoria_aviso_expirado_em?: string | null
          auditoria_aviso_lembrete_em?: string | null
          auditoria_marcada_em?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          link?: string | null
          nome?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organograma_nos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organograma_nos_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "organograma_nos"
            referencedColumns: ["id"]
          },
        ]
      }
      pastas_links: {
        Row: {
          comentario: string | null
          criado_em: string
          criado_por: string | null
          id: string
          nome: string
        }
        Insert: {
          comentario?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome: string
        }
        Update: {
          comentario?: string | null
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      pastas_links_itens: {
        Row: {
          criado_em: string
          id: string
          pasta_id: string
          url: string
        }
        Insert: {
          criado_em?: string
          id?: string
          pasta_id: string
          url: string
        }
        Update: {
          criado_em?: string
          id?: string
          pasta_id?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "pastas_links_itens_pasta_id_fkey"
            columns: ["pasta_id"]
            isOneToOne: false
            referencedRelation: "pastas_links"
            referencedColumns: ["id"]
          },
        ]
      }
      perfis_usuarios: {
        Row: {
          avatar_url: string | null
          cargo: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id: string | null
          criado_em: string
          email: string
          id: string
          nome: string
          status: string
        }
        Insert: {
          avatar_url?: string | null
          cargo?: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id?: string | null
          criado_em?: string
          email: string
          id: string
          nome: string
          status?: string
        }
        Update: {
          avatar_url?: string | null
          cargo?: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id?: string | null
          criado_em?: string
          email?: string
          id?: string
          nome?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "perfis_usuarios_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      projetos: {
        Row: {
          criado_em: string
          criado_por: string | null
          id: string
          nome: string
        }
        Insert: {
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome: string
        }
        Update: {
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome?: string
        }
        Relationships: []
      }
      tarefa_checklist_itens: {
        Row: {
          concluido: boolean
          criado_em: string
          id: string
          tarefa_id: string
          texto: string
        }
        Insert: {
          concluido?: boolean
          criado_em?: string
          id?: string
          tarefa_id: string
          texto: string
        }
        Update: {
          concluido?: boolean
          criado_em?: string
          id?: string
          tarefa_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefa_checklist_itens_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefa_responsaveis: {
        Row: {
          criado_em: string
          id: string
          tarefa_id: string
          usuario_id: string
        }
        Insert: {
          criado_em?: string
          id?: string
          tarefa_id: string
          usuario_id: string
        }
        Update: {
          criado_em?: string
          id?: string
          tarefa_id?: string
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefa_responsaveis_tarefa_id_fkey"
            columns: ["tarefa_id"]
            isOneToOne: false
            referencedRelation: "tarefas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefa_responsaveis_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      tarefas: {
        Row: {
          anexos: Json
          audio: Json | null
          aviso_expirado_enviado_em: string | null
          aviso_lembrete_enviado_em: string | null
          cliente_id: string | null
          complexidade: Database["public"]["Enums"]["complexidade_tarefa"]
          concluido_em: string | null
          criado_por: string | null
          data_criacao: string
          data_vencimento: string | null
          descricao: string | null
          escopo: Database["public"]["Enums"]["escopo_item"]
          id: string
          prioridade: Database["public"]["Enums"]["prioridade_tarefa"]
          projeto_id: string | null
          status: Database["public"]["Enums"]["status_tarefa"]
          tipo: Database["public"]["Enums"]["tipo_item"]
          titulo: string
          video: Json | null
        }
        Insert: {
          anexos?: Json
          audio?: Json | null
          aviso_expirado_enviado_em?: string | null
          aviso_lembrete_enviado_em?: string | null
          cliente_id?: string | null
          complexidade?: Database["public"]["Enums"]["complexidade_tarefa"]
          concluido_em?: string | null
          criado_por?: string | null
          data_criacao?: string
          data_vencimento?: string | null
          descricao?: string | null
          escopo?: Database["public"]["Enums"]["escopo_item"]
          id?: string
          prioridade?: Database["public"]["Enums"]["prioridade_tarefa"]
          projeto_id?: string | null
          status?: Database["public"]["Enums"]["status_tarefa"]
          tipo?: Database["public"]["Enums"]["tipo_item"]
          titulo: string
          video?: Json | null
        }
        Update: {
          anexos?: Json
          audio?: Json | null
          aviso_expirado_enviado_em?: string | null
          aviso_lembrete_enviado_em?: string | null
          cliente_id?: string | null
          complexidade?: Database["public"]["Enums"]["complexidade_tarefa"]
          concluido_em?: string | null
          criado_por?: string | null
          data_criacao?: string
          data_vencimento?: string | null
          descricao?: string | null
          escopo?: Database["public"]["Enums"]["escopo_item"]
          id?: string
          prioridade?: Database["public"]["Enums"]["prioridade_tarefa"]
          projeto_id?: string | null
          status?: Database["public"]["Enums"]["status_tarefa"]
          tipo?: Database["public"]["Enums"]["tipo_item"]
          titulo?: string
          video?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tarefas_projeto_id_fkey"
            columns: ["projeto_id"]
            isOneToOne: false
            referencedRelation: "projetos"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_conversas: {
        Row: {
          conteudo: string
          criado_em: string
          id: string
          role: string
          telegram_chat_id: number
        }
        Insert: {
          conteudo: string
          criado_em?: string
          id?: string
          role: string
          telegram_chat_id: number
        }
        Update: {
          conteudo?: string
          criado_em?: string
          id?: string
          role?: string
          telegram_chat_id?: number
        }
        Relationships: []
      }
      telegram_usuarios: {
        Row: {
          criado_em: string
          id: string
          telegram_chat_id: number
          usuario_id: string
        }
        Insert: {
          criado_em?: string
          id?: string
          telegram_chat_id: number
          usuario_id: string
        }
        Update: {
          criado_em?: string
          id?: string
          telegram_chat_id?: number
          usuario_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_usuarios_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversas: {
        Row: {
          conteudo: string
          criado_em: string
          id: string
          mensagem_id: string | null
          role: string
          whatsapp_numero: string
        }
        Insert: {
          conteudo: string
          criado_em?: string
          id?: string
          mensagem_id?: string | null
          role: string
          whatsapp_numero: string
        }
        Update: {
          conteudo?: string
          criado_em?: string
          id?: string
          mensagem_id?: string | null
          role?: string
          whatsapp_numero?: string
        }
        Relationships: []
      }
      whatsapp_usuarios: {
        Row: {
          criado_em: string
          id: string
          usuario_id: string
          whatsapp_numero: string
        }
        Insert: {
          criado_em?: string
          id?: string
          usuario_id: string
          whatsapp_numero: string
        }
        Update: {
          criado_em?: string
          id?: string
          usuario_id?: string
          whatsapp_numero?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_usuarios_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "perfis_usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      aniversariante_imagens_validas: {
        Args: { _imagens: Json }
        Returns: boolean
      }
      eh_equipe_interna: { Args: { _user_id: string }; Returns: boolean }
      excluir_mural: { Args: { _mural_id: string }; Returns: undefined }
      excluir_mural_quadro: { Args: { _quadro_id: string }; Returns: undefined }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      marcar_aniversariante_publicado: {
        Args: { _id: string; _publicado: boolean }
        Returns: undefined
      }
      mural_tarefa_permitida: { Args: { _tarefa_id: string }; Returns: boolean }
      tarefa_de_admin: { Args: { _tarefa_id: string }; Returns: boolean }
      tem_perfil: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      cargo_usuario: "Admin" | "Membro" | "Cliente" | "Supervisor"
      complexidade_tarefa: "Fácil" | "Média" | "Difícil"
      escopo_item: "geral" | "pessoal"
      plano_cliente: "Bronze" | "Prata" | "Ouro" | "Diamond"
      prioridade_tarefa: "Alta" | "Média" | "Baixa" | "Nenhuma"
      status_demanda: "pendente" | "aceita" | "recusada" | "transferida"
      status_tarefa: "Pendente" | "Em Progresso" | "Em Análise" | "Concluído"
      tipo_item: "tarefa" | "lembrete"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      cargo_usuario: ["Admin", "Membro", "Cliente", "Supervisor"],
      complexidade_tarefa: ["Fácil", "Média", "Difícil"],
      escopo_item: ["geral", "pessoal"],
      plano_cliente: ["Bronze", "Prata", "Ouro", "Diamond"],
      prioridade_tarefa: ["Alta", "Média", "Baixa", "Nenhuma"],
      status_demanda: ["pendente", "aceita", "recusada", "transferida"],
      status_tarefa: ["Pendente", "Em Progresso", "Em Análise", "Concluído"],
      tipo_item: ["tarefa", "lembrete"],
    },
  },
} as const
