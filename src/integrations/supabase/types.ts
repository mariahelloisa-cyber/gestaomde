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
  public: {
    Tables: {
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
          criado_em: string
          descricao: string
          id: string
          justificativa_recusa: string | null
          prazo_sugerido: string | null
          responsavel_id: string | null
          solicitante_email: string | null
          solicitante_nome: string
          status: Database["public"]["Enums"]["status_demanda"]
          tarefa_id: string | null
        }
        Insert: {
          anexos?: Json
          atualizado_em?: string
          criado_em?: string
          descricao: string
          id?: string
          justificativa_recusa?: string | null
          prazo_sugerido?: string | null
          responsavel_id?: string | null
          solicitante_email?: string | null
          solicitante_nome: string
          status?: Database["public"]["Enums"]["status_demanda"]
          tarefa_id?: string | null
        }
        Update: {
          anexos?: Json
          atualizado_em?: string
          criado_em?: string
          descricao?: string
          id?: string
          justificativa_recusa?: string | null
          prazo_sugerido?: string | null
          responsavel_id?: string | null
          solicitante_email?: string | null
          solicitante_nome?: string
          status?: Database["public"]["Enums"]["status_demanda"]
          tarefa_id?: string | null
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
      perfis_usuarios: {
        Row: {
          avatar_url: string | null
          cargo: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id: string | null
          criado_em: string
          email: string
          id: string
          nome: string
        }
        Insert: {
          avatar_url?: string | null
          cargo?: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id?: string | null
          criado_em?: string
          email: string
          id: string
          nome: string
        }
        Update: {
          avatar_url?: string | null
          cargo?: Database["public"]["Enums"]["cargo_usuario"]
          cliente_id?: string | null
          criado_em?: string
          email?: string
          id?: string
          nome?: string
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
      tarefa_responsaveis: {
        Row: {
          id: string
          tarefa_id: string
          usuario_id: string
        }
        Insert: {
          id?: string
          tarefa_id: string
          usuario_id: string
        }
        Update: {
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
          aviso_expirado_enviado_em: string | null
          aviso_lembrete_enviado_em: string | null
          cliente_id: string | null
          criado_por: string | null
          data_criacao: string
          data_vencimento: string | null
          descricao: string | null
          escopo: Database["public"]["Enums"]["escopo_item"]
          id: string
          prioridade: Database["public"]["Enums"]["prioridade_tarefa"]
          status: Database["public"]["Enums"]["status_tarefa"]
          tipo: Database["public"]["Enums"]["tipo_item"]
          titulo: string
        }
        Insert: {
          aviso_expirado_enviado_em?: string | null
          aviso_lembrete_enviado_em?: string | null
          cliente_id?: string | null
          criado_por?: string | null
          data_criacao?: string
          data_vencimento?: string | null
          descricao?: string | null
          escopo?: Database["public"]["Enums"]["escopo_item"]
          id?: string
          prioridade?: Database["public"]["Enums"]["prioridade_tarefa"]
          status?: Database["public"]["Enums"]["status_tarefa"]
          tipo?: Database["public"]["Enums"]["tipo_item"]
          titulo: string
        }
        Update: {
          aviso_expirado_enviado_em?: string | null
          aviso_lembrete_enviado_em?: string | null
          cliente_id?: string | null
          criado_por?: string | null
          data_criacao?: string
          data_vencimento?: string | null
          descricao?: string | null
          escopo?: Database["public"]["Enums"]["escopo_item"]
          id?: string
          prioridade?: Database["public"]["Enums"]["prioridade_tarefa"]
          status?: Database["public"]["Enums"]["status_tarefa"]
          tipo?: Database["public"]["Enums"]["tipo_item"]
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "tarefas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      treinamentos: {
        Row: {
          atualizado_em: string
          capa_url: string | null
          criado_em: string
          criado_por: string | null
          descricao: string | null
          id: string
          plano_destino: string[]
          tipo: string
          titulo: string
          url_video: string
        }
        Insert: {
          atualizado_em?: string
          capa_url?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          plano_destino?: string[]
          tipo?: string
          titulo: string
          url_video: string
        }
        Update: {
          atualizado_em?: string
          capa_url?: string | null
          criado_em?: string
          criado_por?: string | null
          descricao?: string | null
          id?: string
          plano_destino?: string[]
          tipo?: string
          titulo?: string
          url_video?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_meu_plano: { Args: never; Returns: string }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_cliente: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      cargo_usuario: "Admin" | "Membro" | "Cliente" | "Supervisor"
      escopo_item: "geral" | "pessoal"
      plano_cliente: "Bronze" | "Prata" | "Ouro" | "Diamond"
      prioridade_tarefa: "Alta" | "Média" | "Baixa" | "Nenhuma"
      status_demanda: "pendente" | "aceita" | "recusada" | "transferida"
      status_tarefa: "Pendente" | "Em Progresso" | "Concluído"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cargo_usuario: ["Admin", "Membro", "Cliente", "Supervisor"],
      escopo_item: ["geral", "pessoal"],
      plano_cliente: ["Bronze", "Prata", "Ouro", "Diamond"],
      prioridade_tarefa: ["Alta", "Média", "Baixa", "Nenhuma"],
      status_demanda: ["pendente", "aceita", "recusada", "transferida"],
      status_tarefa: ["Pendente", "Em Progresso", "Concluído"],
      tipo_item: ["tarefa", "lembrete"],
    },
  },
} as const
